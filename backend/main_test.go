package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	dbx "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

func call(t *testing.T, s *store, method string, params any) (any, *dbx.PluginError) {
	t.Helper()
	raw, err := json.Marshal(params)
	if err != nil {
		t.Fatal(err)
	}
	return s.Handle(dbx.RequestContext{}, method, raw, nil)
}

func seed(t *testing.T, s *store) snapshot {
	t.Helper()
	result, err := call(t, s, "reader/chunk-put", map[string]string{"text": "第一章\n你好🌧️"})
	if err != nil {
		t.Fatal(err)
	}
	id := "book-1"
	return snapshot{Data: &library{Books: []book{{ID: id, Title: "测试小说", Position: 5, Chunks: []string{result.(map[string]string)["hash"]}}}, ActiveID: &id, Settings: json.RawMessage(`{"theme":"dark","fontSize":23}`)}}
}

func TestRestoreAndEmptyShelf(t *testing.T) {
	s := &store{dir: t.TempDir()}
	value := seed(t, s)
	if _, err := call(t, s, "reader/save", value); err != nil {
		t.Fatal(err)
	}
	// 新存储实例没有内存状态，等价于重新启动后端后的读取。
	restarted := &store{dir: s.dir}
	result, err := call(t, restarted, "reader/load", nil)
	if err != nil {
		t.Fatal(err)
	}
	saved := result.(snapshot)
	if saved.Revision != 1 || saved.Data.Books[0].Position != 5 || string(saved.Data.Settings) != string(value.Data.Settings) {
		t.Fatalf("恢复数据不一致：%+v", saved)
	}
	text, err := call(t, restarted, "reader/chunk-get", map[string]string{"hash": value.Data.Books[0].Chunks[0]})
	if err != nil || text.(map[string]string)["text"] != "第一章\n你好🌧️" {
		t.Fatal("正文恢复失败", err)
	}
	empty := snapshot{Revision: 1, Data: &library{Books: []book{}, Settings: json.RawMessage(`{}`)}}
	if _, err := call(t, restarted, "reader/save", empty); err != nil {
		t.Fatal(err)
	}
	loaded, loadErr := (&store{dir: s.dir}).read()
	if loadErr != nil || loaded.Revision != 2 || len(loaded.Data.Books) != 0 {
		t.Fatal("空书架未保存", loadErr)
	}
	if _, err := os.Stat(filepath.Join(s.dir, "texts", value.Data.Books[0].Chunks[0])); !os.IsNotExist(err) {
		t.Fatal("已移除正文未清理")
	}
}

func TestEbookMetadataAndInvalidTOCPreserveShelf(t *testing.T) {
	s := &store{dir: t.TempDir()}
	value := seed(t, s)
	value.Data.Books[0].Format = "epub"
	value.Data.Books[0].TOC = []tocEntry{{Title: "雨巷", Start: 0}, {Title: "晴空", Start: 4}}
	if _, err := call(t, s, "reader/save", value); err != nil {
		t.Fatal(err)
	}
	restored, err := (&store{dir: s.dir}).read()
	if err != nil || restored.Data.Books[0].Format != "epub" || len(restored.Data.Books[0].TOC) != 2 || restored.Data.Books[0].TOC[1].Start != 4 {
		t.Fatal("电子书目录未恢复", err)
	}
	before, _ := os.ReadFile(filepath.Join(s.dir, "library.json"))
	value.Revision = 1
	for _, toc := range [][]tocEntry{
		{{Title: "章", Start: -1}}, {{Title: "章", Start: 100}}, {{Title: "", Start: 0}},
		{{Title: "甲", Start: 1}, {Title: "乙", Start: 1}}, {{Title: "甲", Start: 2}, {Title: "乙", Start: 1}},
	} {
		value.Data.Books[0].TOC = toc
		if _, err := call(t, s, "reader/save", value); err == nil {
			t.Fatal("允许写入无效目录", toc)
		}
	}
	after, _ := os.ReadFile(filepath.Join(s.dir, "library.json"))
	if string(before) != string(after) {
		t.Fatal("无效目录覆盖了已有书架")
	}
}

func TestEbookLibraryRequestLimit(t *testing.T) {
	s := &store{dir: t.TempDir()}
	value := seed(t, s)
	// 目录使索引超过旧版 256 KiB，仍应能保存；超过 1 MiB 则拒绝。
	result, err := call(t, s, "reader/chunk-put", map[string]string{"text": strings.Repeat("文", 3000)})
	if err != nil {
		t.Fatal(err)
	}
	value.Data.Books[0].Chunks = []string{result.(map[string]string)["hash"]}
	for i := 0; i < 600; i++ {
		value.Data.Books[0].TOC = append(value.Data.Books[0].TOC, tocEntry{Title: strings.Repeat("章", 200), Start: i})
	}
	if _, err := call(t, s, "reader/save", value); err != nil {
		t.Fatal(err)
	}
	value.Revision = 1
	for i := 600; i < 2000; i++ {
		value.Data.Books[0].TOC = append(value.Data.Books[0].TOC, tocEntry{Title: strings.Repeat("章", 200), Start: i})
	}
	if _, err := call(t, s, "reader/save", value); err == nil {
		t.Fatal("允许写入超过 1 MiB 的索引")
	}
}

func TestRejectConflictAndMissingContentWithoutClobber(t *testing.T) {
	s := &store{dir: t.TempDir()}
	value := seed(t, s)
	if _, err := call(t, s, "reader/save", value); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(s.dir, "library.json"))
	if _, err := call(t, s, "reader/save", value); err == nil || err.Code != -32009 {
		t.Fatal("未阻止过期窗口覆盖", err)
	}
	value.Revision = 1
	value.Data.Books[0].Chunks = []string{strings.Repeat("a", 64)}
	if _, err := call(t, s, "reader/save", value); err == nil {
		t.Fatal("允许保存缺少正文的书架")
	}
	after, _ := os.ReadFile(filepath.Join(s.dir, "library.json"))
	if string(before) != string(after) {
		t.Fatal("失败写入破坏了已有书架")
	}
}

func TestCorruptFileAndInvalidChunk(t *testing.T) {
	s := &store{dir: t.TempDir()}
	for _, hash := range []string{"../library.json", "", strings.Repeat("f", 64)} {
		if _, err := call(t, s, "reader/chunk-get", map[string]string{"hash": hash}); err == nil {
			t.Fatal("接受无效正文路径")
		}
	}
	if _, err := call(t, s, "reader/chunk-put", map[string]string{"text": strings.Repeat("x", chunkLimit*3+1)}); err == nil {
		t.Fatal("接受超大分块")
	}
	value := seed(t, s)
	if err := os.WriteFile(filepath.Join(s.dir, "library.json"), []byte("{broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := call(t, s, "reader/load", nil); err == nil {
		t.Fatal("损坏书架被当成空书架")
	}
	if _, err := call(t, s, "reader/save", value); err == nil {
		t.Fatal("损坏书架被静默覆盖")
	}
	path := filepath.Join(s.dir, "texts", value.Data.Books[0].Chunks[0])
	if err := os.WriteFile(path, []byte("被修改的正文"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.readChunk(value.Data.Books[0].Chunks[0]); err == nil {
		t.Fatal("未发现正文损坏")
	}
}

func TestDiskWriteFailurePreservesShelf(t *testing.T) {
	s := &store{dir: t.TempDir()}
	value := seed(t, s)
	if _, err := call(t, s, "reader/save", value); err != nil {
		t.Fatal(err)
	}
	// 使用目录占据目标文件位置，可在 Windows 和 Unix 稳定触发替换失败。
	blocked := filepath.Join(s.dir, "blocked")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	if err := writeAtomic(blocked, []byte("new")); err == nil {
		t.Fatal("没有报告写入失败")
	}
	loaded, err := s.read()
	if err != nil || loaded.Revision != 1 {
		t.Fatal("写入失败破坏旧书架", err)
	}
}
