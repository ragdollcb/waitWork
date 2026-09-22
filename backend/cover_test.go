package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func exampleCover() coverSnapshot {
	return coverSnapshot{Data: &coverData{Title: "订单核对", ConnectionLabel: "业务库 / MySQL", SQL: "SELECT id FROM orders;", Result: &coverResult{SQL: "SELECT id FROM orders;", Columns: []coverColumn{{Name: "id", Type: "TEXT"}}, Rows: [][]any{{"001"}, {"<script>"}}, ElapsedMS: 0}}}
}

func TestCoverRestoreConflictAndShelfIsolation(t *testing.T) {
	s := &store{dir: t.TempDir()}
	missing, err := call(t, s, "cover/load", nil)
	if err != nil || missing.(coverSnapshot).Data != nil {
		t.Fatal("首次加载失败", err)
	}
	value := exampleCover()
	if _, err := call(t, s, "cover/save", value); err != nil {
		t.Fatal(err)
	}
	restarted := &store{dir: s.dir}
	loaded, err := call(t, restarted, "cover/load", nil)
	if err != nil {
		t.Fatal(err)
	}
	saved := loaded.(coverSnapshot)
	if saved.Revision != 1 || saved.Data.Title != value.Data.Title || saved.Data.Result.Rows[0][0] != "001" {
		t.Fatalf("查询恢复失败：%+v", saved)
	}
	path := filepath.Join(s.dir, "query-cover.json")
	before, _ := os.ReadFile(path)
	value.Data.SQL = "过期内容"
	if _, err := call(t, restarted, "cover/save", value); err == nil || err.Code != -32009 {
		t.Fatal("旧修订号未被拒绝", err)
	}
	shelf := seed(t, s)
	if _, err := call(t, s, "reader/save", shelf); err != nil {
		t.Fatal(err)
	}
	if _, err := call(t, s, "reader/save", snapshot{Revision: 1, Data: &library{Books: []book{}, Settings: json.RawMessage(`{}`)}}); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("书架操作覆盖查询文件")
	}
	value.Revision = 1
	value.Data.Result = nil
	if _, err := call(t, restarted, "cover/save", value); err != nil {
		t.Fatal(err)
	}
	cleared, err := call(t, &store{dir: s.dir}, "cover/load", nil)
	if err != nil || cleared.(coverSnapshot).Data.Result != nil || cleared.(coverSnapshot).Revision != 2 {
		t.Fatal("清空结果没有持久化", err)
	}
}

func TestCoverResultLabelCompatibility(t *testing.T) {
	s := &store{dir: t.TempDir()}
	if _, err := call(t, s, "cover/save", exampleCover()); err != nil {
		t.Fatal(err)
	}
	old, err := s.readCover()
	if err != nil || old.Data.ResultLabel != "" {
		t.Fatal("旧查询应使用默认标签", err)
	}
	old.Data.ResultLabel = "订单明细"
	if _, err := call(t, s, "cover/save", old); err != nil {
		t.Fatal(err)
	}
	restarted := &store{dir: s.dir}
	saved, err := restarted.readCover()
	if err != nil || saved.Data.ResultLabel != "订单明细" || saved.Data.Result.Rows[0][0] != "001" {
		t.Fatal("标签或结果恢复错误", err)
	}
	saved.Data.ResultLabel = ""
	if _, err := call(t, restarted, "cover/save", saved); err != nil {
		t.Fatal(err)
	}
	cleared, err := restarted.readCover()
	if err != nil || cleared.Data.ResultLabel != "" {
		t.Fatal("清空标签失败", err)
	}
}

func TestInvalidCoverPreservesFile(t *testing.T) {
	s := &store{dir: t.TempDir()}
	if _, err := call(t, s, "cover/save", exampleCover()); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.dir, "query-cover.json")
	before, _ := os.ReadFile(path)
	for name, mutate := range map[string]func(*coverData){
		"结果标签超长": func(d *coverData) { d.ResultLabel = strings.Repeat("😀", 129) },
		"空名称":    func(d *coverData) { d.Title = " " },
		"名称超长":   func(d *coverData) { d.Title = strings.Repeat("😀", 129) },
		"SQL超限":  func(d *coverData) { d.SQL = strings.Repeat("a", sqlLimit+1) },
		"列数不一致":  func(d *coverData) { d.Result.Rows = [][]any{{"a", "b"}} },
		"不合法单元格": func(d *coverData) { d.Result.Rows = [][]any{{map[string]string{"a": "b"}}} },
		"行数超限":   func(d *coverData) { d.Result.Rows = make([][]any, 501) },
		"列数超限":   func(d *coverData) { d.Result.Columns = make([]coverColumn, 51) },
		"存档超限":   func(d *coverData) { d.Result.Rows = [][]any{{strings.Repeat("文", coverLimit/3)}} },
	} {
		t.Run(name, func(t *testing.T) {
			value := exampleCover()
			value.Revision = 1
			mutate(value.Data)
			if _, err := call(t, s, "cover/save", value); err == nil {
				t.Fatal("错误内容写入成功")
			}
			after, _ := os.ReadFile(path)
			if string(before) != string(after) {
				t.Fatal("错误内容覆盖原文件")
			}
		})
	}
}

func TestCorruptCoverAndWriteFailure(t *testing.T) {
	s := &store{dir: t.TempDir()}
	path := filepath.Join(s.dir, "query-cover.json")
	for _, content := range []string{"{broken", `{"revision":1,"data":null}`, strings.Repeat(" ", coverLimit+1)} {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := call(t, s, "cover/load", nil); err == nil {
			t.Fatal("损坏文件未报错")
		}
		if _, err := call(t, s, "cover/save", exampleCover()); err == nil {
			t.Fatal("覆盖了损坏文件")
		}
		after, _ := os.ReadFile(path)
		if string(after) != content {
			t.Fatal("损坏文件被修改")
		}
	}
	// 目标是已有目录时替换必须失败，目录中的旧数据保持原样。
	blocked := filepath.Join(t.TempDir(), "query-cover.json")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	old := filepath.Join(blocked, "old")
	if err := os.WriteFile(old, []byte("保留"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeAtomic(blocked, []byte("new")); err == nil {
		t.Fatal("错误路径写入成功")
	}
	if data, err := os.ReadFile(old); err != nil || string(data) != "保留" {
		t.Fatal("写入失败损坏旧数据")
	}
}
