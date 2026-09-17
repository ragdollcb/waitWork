package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"unicode/utf16"
	"unicode/utf8"

	dbx "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

const chunkLimit = 128 * 1024

var hashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var idPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

type book struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Position int      `json:"position"`
	Chunks   []string `json:"chunks"`
}
type library struct {
	Books    []book          `json:"books"`
	ActiveID *string         `json:"activeId"`
	Settings json.RawMessage `json:"settings"`
}
type snapshot struct {
	Revision int64    `json:"revision"`
	Data     *library `json:"data"`
}
type store struct {
	mu      sync.Mutex
	dir     string
	lengths map[string]int
}

// 先同步临时文件，再替换正式文件；写入失败时保留上一份完整书架。
func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".waitwork-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func (s *store) read() (snapshot, error) {
	var value snapshot
	data, err := os.ReadFile(filepath.Join(s.dir, "library.json"))
	if errors.Is(err, os.ErrNotExist) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	err = json.Unmarshal(data, &value)
	if err == nil && (value.Revision < 1 || value.Data == nil || value.Data.Books == nil) {
		err = errors.New("书架文件不完整，请保留本地数据并检查文件")
	}
	return value, err
}

func (s *store) readChunk(hash string) ([]byte, error) {
	if !hashPattern.MatchString(hash) {
		return nil, errors.New("无效的正文标识")
	}
	data, err := os.ReadFile(filepath.Join(s.dir, "texts", hash))
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != hash || len(data) > chunkLimit*3 || !utf8.Valid(data) {
		return nil, errors.New("本地小说正文损坏，请保留数据并检查文件")
	}
	if s.lengths == nil {
		s.lengths = map[string]int{}
	}
	s.lengths[hash] = len(utf16.Encode([]rune(string(data))))
	return data, nil
}

func (s *store) validate(value *library) error {
	if value == nil || value.Books == nil || len(value.Books) > 20 || len(value.Settings) > 4096 {
		return errors.New("书架数据无效")
	}
	var settings map[string]any
	if json.Unmarshal(value.Settings, &settings) != nil || settings == nil {
		return errors.New("阅读设置无效")
	}
	ids := map[string]bool{}
	total := 0
	for _, b := range value.Books {
		if !idPattern.MatchString(b.ID) || ids[b.ID] || b.Title == "" || len(utf16.Encode([]rune(b.Title))) > 200 || len(b.Chunks) == 0 || len(b.Chunks) > 128 {
			return errors.New("书籍信息无效或超出限制")
		}
		ids[b.ID] = true
		length := 0
		for _, hash := range b.Chunks {
			// 已校验的正文长度可复用，滚动时不重复读取和散列整本小说。
			if _, known := s.lengths[hash]; !known {
				if _, err := s.readChunk(hash); err != nil {
					return fmt.Errorf("读取小说正文失败：%w", err)
				}
			}
			length += s.lengths[hash]
		}
		if length > 8*1024*1024 || b.Position < 0 || b.Position > length {
			return errors.New("正文或阅读位置超出限制")
		}
		total += length
	}
	if total > 24*1024*1024 {
		return errors.New("书架正文总量超出限制")
	}
	if (len(ids) > 0 && (value.ActiveID == nil || !ids[*value.ActiveID])) || (len(ids) == 0 && value.ActiveID != nil) {
		return errors.New("当前阅读书籍无效")
	}
	return nil
}

func (s *store) Handle(_ dbx.RequestContext, method string, raw json.RawMessage, _ *dbx.Emitter) (any, *dbx.PluginError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fail := func(err error) (any, *dbx.PluginError) {
		return nil, dbx.NewError(-32000, "本地自动保存失败："+err.Error())
	}
	switch method {
	case "reader/load":
		value, err := s.read()
		if err != nil {
			return fail(err)
		}
		return value, nil
	case "reader/chunk-put":
		var p struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(raw, &p) != nil || len(p.Text) == 0 || len(p.Text) > chunkLimit*3 {
			return fail(errors.New("正文分块无效或过大"))
		}
		digest := sha256.Sum256([]byte(p.Text))
		hash := hex.EncodeToString(digest[:])
		if err := writeAtomic(filepath.Join(s.dir, "texts", hash), []byte(p.Text)); err != nil {
			return fail(err)
		}
		if s.lengths == nil {
			s.lengths = map[string]int{}
		}
		s.lengths[hash] = len(utf16.Encode([]rune(p.Text)))
		return map[string]string{"hash": hash}, nil
	case "reader/chunk-get":
		var p struct {
			Hash string `json:"hash"`
		}
		if json.Unmarshal(raw, &p) != nil {
			return fail(errors.New("正文请求无效"))
		}
		data, err := s.readChunk(p.Hash)
		if err != nil {
			return fail(err)
		}
		return map[string]string{"text": string(data)}, nil
	case "reader/save":
		var p snapshot
		if len(raw) > 256*1024 || json.Unmarshal(raw, &p) != nil {
			return fail(errors.New("书架请求无效"))
		}
		current, err := s.read()
		if err != nil {
			return fail(err)
		}
		if current.Revision != p.Revision {
			return nil, dbx.NewError(-32009, "书架已在其他窗口更新，请重新打开插件后继续阅读。")
		}
		if err := s.validate(p.Data); err != nil {
			return fail(err)
		}
		p.Revision++
		data, err := json.Marshal(p)
		if err != nil {
			return fail(err)
		}
		if err := writeAtomic(filepath.Join(s.dir, "library.json"), data); err != nil {
			return fail(err)
		}
		// 索引提交成功后才清理已移除书籍的正文，失败不能破坏旧书架。
		if current.Data != nil {
			used := map[string]bool{}
			for _, b := range p.Data.Books {
				for _, hash := range b.Chunks {
					used[hash] = true
				}
			}
			for _, b := range current.Data.Books {
				for _, hash := range b.Chunks {
					if !used[hash] && hashPattern.MatchString(hash) {
						_ = os.Remove(filepath.Join(s.dir, "texts", hash))
						delete(s.lengths, hash)
					}
				}
			}
		}
		return map[string]int64{"revision": p.Revision}, nil
	default:
		return nil, dbx.MethodNotFound(method)
	}
}

func main() {
	dir := os.Getenv("WAITWORK_DATA_DIR")
	if dir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			log.Fatal(err)
		}
		dir = filepath.Join(base, "waitWork")
	}
	server := dbx.NewServer(dbx.Metadata{ID: "monstercat.waitwork", Version: "0.5.0", Capabilities: []string{}}, &store{dir: dir})
	if err := server.Serve(); err != nil {
		log.Fatal(err)
	}
}
