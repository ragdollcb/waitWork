package main

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	dbx "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

const coverLimit = 1024 * 1024
const sqlLimit = 256 * 1024
const maxCoverRevision = int64(9007199254740991)

type coverColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}
type coverResult struct {
	SQL       string        `json:"sql"`
	Columns   []coverColumn `json:"columns"`
	Rows      [][]any       `json:"rows"`
	ElapsedMS float64       `json:"elapsedMs"`
}
type coverData struct {
	Title           string       `json:"title"`
	ConnectionLabel string       `json:"connectionLabel"`
	ResultLabel     string       `json:"resultLabel,omitempty"`
	SQL             string       `json:"sql"`
	Result          *coverResult `json:"result"`
}
type coverSnapshot struct {
	Revision int64      `json:"revision"`
	Data     *coverData `json:"data"`
}

func validateCover(data *coverData) error {
	if data == nil {
		return errors.New("查询内容不完整")
	}
	for _, name := range []string{data.Title, data.ConnectionLabel} {
		if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 128 {
			return errors.New("查询名称与连接显示名不能为空且不能超过 128 个字符")
		}
	}
	if len(data.SQL) > sqlLimit {
		return errors.New("SQL 不能超过 256 KiB")
	}
	if utf8.RuneCountInString(data.ResultLabel) > 128 {
		return errors.New("结果标签名称不能超过 128 个字符")
	}
	if result := data.Result; result != nil {
		if len(result.SQL) > sqlLimit || len(result.Columns) == 0 || len(result.Columns) > 50 || result.Rows == nil || len(result.Rows) > 500 || math.IsNaN(result.ElapsedMS) || math.IsInf(result.ElapsedMS, 0) || result.ElapsedMS < 0 {
			return errors.New("查询结果无效，最多支持 500 行、50 列")
		}
		for _, column := range result.Columns {
			if strings.TrimSpace(column.Name) == "" || utf8.RuneCountInString(column.Name) > 128 || (column.Type != "TEXT" && column.Type != "INTEGER" && column.Type != "DECIMAL") {
				return errors.New("查询结果列名或类型无效")
			}
		}
		for _, row := range result.Rows {
			if len(row) != len(result.Columns) {
				return errors.New("结果表每行的列数必须与表头一致")
			}
			for _, value := range row {
				switch cell := value.(type) {
				case nil, string:
				case float64:
					if math.IsNaN(cell) || math.IsInf(cell, 0) {
						return errors.New("单元格数字无效")
					}
				default:
					return errors.New("单元格必须是文本或数字")
				}
			}
		}
	}
	// 与前端相同，按最长修订号预留存档大小。
	raw, err := json.Marshal(coverSnapshot{Revision: maxCoverRevision, Data: data})
	if err != nil {
		return err
	}
	if len(raw) > coverLimit {
		return errors.New("查询内容不能超过 1 MiB")
	}
	return nil
}

func (s *store) readCover() (coverSnapshot, error) {
	var value coverSnapshot
	f, err := os.Open(filepath.Join(s.dir, "query-cover.json"))
	if errors.Is(err, os.ErrNotExist) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, coverLimit+1))
	if err != nil {
		return value, err
	}
	if len(raw) > coverLimit || json.Unmarshal(raw, &value) != nil || value.Revision < 1 || value.Revision >= maxCoverRevision {
		return value, errors.New("查询文件损坏或超出限制，请保留文件并检查")
	}
	return value, validateCover(value.Data)
}

// 调用方持有书架存储锁；查询使用独立文件和修订号，互不覆盖。
func (s *store) handleCover(method string, raw json.RawMessage) (any, *dbx.PluginError) {
	fail := func(err error) (any, *dbx.PluginError) {
		return nil, dbx.NewError(-32000, "查询内容保存或读取失败："+err.Error())
	}
	if method != "cover/load" && method != "cover/save" {
		return nil, dbx.MethodNotFound(method)
	}
	current, err := s.readCover()
	if err != nil {
		return fail(err)
	}
	if method == "cover/load" {
		return current, nil
	}
	var value coverSnapshot
	if len(raw) > coverLimit || json.Unmarshal(raw, &value) != nil || value.Revision < 0 || value.Revision >= maxCoverRevision-1 {
		return fail(errors.New("查询内容无效或超出限制"))
	}
	if value.Revision != current.Revision {
		return nil, dbx.NewError(-32009, "查询内容已在其他窗口更新，请重新打开插件。")
	}
	if err := validateCover(value.Data); err != nil {
		return fail(err)
	}
	value.Revision++
	data, err := json.Marshal(value)
	if err != nil {
		return fail(err)
	}
	if err := writeAtomic(filepath.Join(s.dir, "query-cover.json"), data); err != nil {
		return fail(err)
	}
	return map[string]int64{"revision": value.Revision}, nil
}
