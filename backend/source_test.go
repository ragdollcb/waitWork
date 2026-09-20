package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	dbx "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
	"golang.org/x/net/html"
	"golang.org/x/text/encoding/simplifiedchinese"
)

const testBookPath = "/Book/19/19392/"
const testChapterPath = testBookPath + "13590539.html"
const catalogHTML = `<meta charset="utf-8"><div id="info"><h1>测试小说</h1><p>作&nbsp;者：测试作者</p><p>最新章节：第二章</p></div><div id="intro"><p>这是简介。</p></div><div id="list"><dl><dd><a href="13590539.html">第一章</a></dd><dd><a href="13590539.html">重复章节</a></dd><dd><a href="13590540.html">第二章</a></dd><dd><a href="https://evil.test/Book/19/19392/13590541.html">无效</a></dd></dl></div>`
const chapterHTML = `<meta charset="utf-8"><div class="bookname"><h1>第一章</h1></div><div id="content">笔趣阁 最新永久域名：<a href="http://www.biquge001.com">www.biquge001.com</a> ，请大家牢记本域名并相互转告，谢谢！<br>第一段。<a href="http://www.biquge001.com">www.biquge001.com</a><br>第二段 &lt;img src=x onerror=alert(1)&gt;<script>alert('广告')</script><p>第三段。</p></div>`
const searchHTML = `<meta charset="gbk"><table class="grid"><tr><th>小说</th></tr><tr><td><a href="http://www.biquge001.com/Book/19/19392/">测试小说</a></td><td>第二章</td><td>测试作者</td></tr></table><div id="pagelink"><a href="/modules/article/search.php?searchkey=x&page=2">下一页</a></div>`

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func response(r *http.Request, status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"text/html"}}, Body: io.NopCloser(strings.NewReader(body)), Request: r}
}

// 旧解析用例显式选择书源；缺省禁用行为由配置专项用例单独验证。
func sourceCall(t *testing.T, s *store, method string, params any) (any, *dbx.PluginError) {
	t.Helper()
	if strings.HasPrefix(method, "source/") {
		raw, _ := json.Marshal(params)
		var values map[string]any
		_ = json.Unmarshal(raw, &values)
		if values == nil {
			values = map[string]any{}
		}
		values["origin"] = legacySourceOrigin
		values["allowNetwork"] = true
		params = values
	}
	return call(t, s, method, params)
}

func fixtureStore(t *testing.T) (*store, *atomic.Int32) {
	t.Helper()
	calls := &atomic.Int32{}
	s := &store{dir: t.TempDir(), client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		switch r.URL.Path {
		case searchPath:
			if r.URL.Query().Get("searchkey") != "\xc9\xf1\xc3\xd8" {
				t.Errorf("搜索词未按 GBK 编码: %s", r.URL.RawQuery)
			}
			body, _ := simplifiedchinese.GBK.NewEncoder().String(searchHTML)
			return response(r, 200, body), nil
		case testBookPath:
			return response(r, 200, catalogHTML), nil
		case testChapterPath, testBookPath + "13590540.html":
			return response(r, 200, chapterHTML), nil
		default:
			return response(r, 404, ""), nil
		}
	})}}
	return s, calls
}

func TestSourceSearchAndParsing(t *testing.T) {
	s, _ := fixtureStore(t)
	v, err := sourceCall(t, s, "source/search", map[string]any{"query": "神秘", "page": 1})
	if err != nil {
		t.Fatal(err)
	}
	result := v.(sourceSearch)
	if len(result.Books) != 1 || result.Books[0].Title != "测试小说" || !result.HasNext {
		t.Fatalf("搜索结果不正确: %+v", result)
	}
	doc, _ := html.Parse(strings.NewReader(catalogHTML))
	single, e := parseSearch(doc, legacySourceOrigin, testBookPath, 1)
	if e != nil || len(single.Books) != 1 {
		t.Fatal("唯一结果跳转未识别", e)
	}
	catalog, e := parseCatalog(doc, legacySourceOrigin, testBookPath)
	if e != nil || len(catalog.Chapters) != 2 || catalog.Chapters[0].Path != testChapterPath || catalog.Author != "测试作者" {
		t.Fatal("目录解析错误", catalog, e)
	}
	doc, _ = html.Parse(strings.NewReader(chapterHTML))
	chapter, e := parseChapter(doc, testChapterPath)
	if e != nil || chapter.Text != "第一段。\n第二段 <img src=x onerror=alert(1)>\n第三段。" {
		t.Fatal("正文清理错误", chapter, e)
	}
	doc, _ = html.Parse(strings.NewReader(`<table class="grid"><tr><th>书名</th></tr></table>`))
	empty, e := parseSearch(doc, legacySourceOrigin, searchPath, 1)
	if e != nil || len(empty.Books) != 0 {
		t.Fatal("空结果处理错误", e)
	}
	doc, _ = html.Parse(strings.NewReader(`<h1>访问受限</h1>`))
	if _, e = parseChapter(doc, testChapterPath); e == nil {
		t.Fatal("错误页被识别为正文")
	}
}

func TestSourceCacheRestoreAndRefreshFailure(t *testing.T) {
	s, calls := fixtureStore(t)
	params := map[string]any{"bookPath": testBookPath, "chapterPath": testChapterPath}
	for _, method := range []string{"source/catalog", "source/chapter"} {
		if _, err := sourceCall(t, s, method, params); err != nil {
			t.Fatal(err)
		}
	}
	id := onlineID(testBookPath)
	value := snapshot{Data: &library{Books: []book{{ID: id, Kind: "online", Source: "biquge001", BookPath: testBookPath, ChapterPath: testChapterPath, Title: "测试小说", Position: 3}}, ActiveID: &id, Settings: json.RawMessage(`{}`)}}
	if _, err := sourceCall(t, s, "reader/save", value); err != nil {
		t.Fatal(err)
	}
	restored := &store{dir: s.dir, client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) { return response(r, 503, ""), nil })}}
	for _, method := range []string{"source/catalog", "source/chapter"} {
		if _, err := sourceCall(t, restored, method, params); err != nil {
			t.Fatal("离线缓存恢复失败", err)
		}
	}
	if calls.Load() != 2 {
		t.Fatal("缓存命中后再次联网")
	}
	params["refresh"] = true
	if _, err := sourceCall(t, restored, "source/catalog", params); err == nil {
		t.Fatal("未报告刷新失败")
	}
	params["refresh"] = false
	if _, err := sourceCall(t, restored, "source/catalog", params); err != nil {
		t.Fatal("刷新失败破坏旧目录", err)
	}
	v, err := sourceCall(t, restored, "reader/load", nil)
	if err != nil || v.(snapshot).Data.Books[0].Position != 3 {
		t.Fatal("在线进度丢失", err)
	}
	if _, err := sourceCall(t, restored, "reader/save", snapshot{Revision: 1, Data: &library{Books: []book{}, Settings: json.RawMessage(`{}`)}}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(restored.onlineDir(legacySourceOrigin, testBookPath)); !os.IsNotExist(err) {
		t.Fatal("删除后缓存仍然存在")
	}
}

func TestSourceValidationAndCacheWriteFailure(t *testing.T) {
	for _, raw := range []string{"https://evil.test/Book/19/19392/", "https://www.biquge001.com@evil.test/Book/19/19392/", "/login.php", "/Book/19/19392/../", "file:///Book/19/19392/", "https://www.biquge001.com:443/Book/19/19392/"} {
		if _, err := sourceURL(legacySourceOrigin, raw); err == nil {
			t.Errorf("接受非法地址 %s", raw)
		}
	}
	u, err := sourceURL(legacySourceOrigin, "http://www.biquge001.com"+testChapterPath)
	if err != nil || u.Scheme != "https" {
		t.Fatal("未升级 HTTPS")
	}
	s, _ := fixtureStore(t)
	if err := os.WriteFile(filepath.Join(s.dir, "online"), []byte("阻止创建目录"), 0600); err != nil {
		t.Fatal(err)
	}
	v, rpcErr := sourceCall(t, s, "source/chapter", map[string]string{"bookPath": testBookPath, "chapterPath": testChapterPath})
	if rpcErr != nil || v.(sourceText).Cached || v.(sourceText).Warning == "" || v.(sourceText).Text == "" {
		t.Fatal("缓存失败应仍允许阅读并提示", v, rpcErr)
	}
}

func TestSourceNetworkDoesNotBlockSaveOrRestoreDeletedCache(t *testing.T) {
	s, _ := fixtureStore(t)
	id := onlineID(testBookPath)
	value := snapshot{Data: &library{Books: []book{{ID: id, Kind: "online", Source: "biquge001", BookPath: testBookPath, ChapterPath: testChapterPath, Title: "测试", Position: 0}}, ActiveID: &id, Settings: json.RawMessage(`{}`)}}
	if _, err := sourceCall(t, s, "reader/save", value); err != nil {
		t.Fatal(err)
	}
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan bool, 1)
	s.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		close(started)
		<-release
		return response(r, 200, chapterHTML), nil
	})}
	go func() {
		_, err := sourceCall(t, s, "source/chapter", map[string]string{"bookPath": testBookPath, "chapterPath": testChapterPath})
		done <- err != nil
	}()
	<-started
	saved := make(chan bool, 1)
	go func() {
		_, err := sourceCall(t, s, "reader/save", snapshot{Revision: 1, Data: &library{Books: []book{}, Settings: json.RawMessage(`{}`)}})
		saved <- err == nil
	}()
	select {
	case ok := <-saved:
		if !ok {
			t.Error("保存失败")
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("网络请求阻塞了保存")
	}
	close(release)
	if !<-done {
		t.Fatal("删除前发出的请求未失效")
	}
	if _, err := os.Stat(s.onlineDir(legacySourceOrigin, testBookPath)); !os.IsNotExist(err) {
		t.Fatal("迟到请求重新生成缓存")
	}
}

func TestSourceRejectsRedirectsAndOversizedResponses(t *testing.T) {
	for _, target := range []string{"https://evil.test/Book/19/19392/", "http://127.0.0.1/Book/19/19392/", "https://www.biquge001.com/login.php"} {
		t.Run(target, func(t *testing.T) {
			calls := 0
			s := &store{client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				res := response(r, 302, "")
				res.Header.Set("Location", target)
				return res, nil
			})}}
			if _, _, err := s.fetchPage(legacySourceOrigin, testBookPath); err == nil || calls != 1 {
				t.Fatal("不安全的重定向被执行", calls, err)
			}
		})
	}
	for _, status := range []int{403, 429, 503, 200} {
		s := &store{client: &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			return response(r, status, strings.Repeat("x", onlinePageLimit+1)), nil
		})}}
		if _, _, err := s.fetchPage(legacySourceOrigin, testBookPath); err == nil {
			t.Fatal("异常或超限响应未拒绝", status)
		}
	}
}

func TestSourceLive(t *testing.T) {
	if os.Getenv("WAITWORK_LIVE_TEST") != "1" {
		t.Skip("真实书源联调需显式启用")
	}
	s := &store{dir: t.TempDir()}
	for _, method := range []string{"source/search", "source/catalog", "source/chapter"} {
		v, err := sourceCall(t, s, method, map[string]any{"query": "神秘复苏", "page": 1, "bookPath": testBookPath, "chapterPath": testChapterPath})
		if err != nil {
			t.Fatal(method, err)
		}
		switch result := v.(type) {
		case sourceSearch:
			if len(result.Books) == 0 {
				t.Fatal("无搜索结果")
			}
		case sourceCatalog:
			if len(result.Chapters) < 2 {
				t.Fatal("缺少目录")
			}
		case sourceText:
			if len(result.Text) < 100 {
				t.Fatal("正文为空")
			}
		}
	}
}
