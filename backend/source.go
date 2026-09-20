package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	dbx "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
	"golang.org/x/net/html"
	"golang.org/x/net/html/charset"
	"golang.org/x/text/encoding/simplifiedchinese"
)

const sourceOrigin = "https://www.biquge001.com"
const searchPath = "/modules/article/search.php"
const onlinePageLimit = 2 * 1024 * 1024

var bookPathPattern = regexp.MustCompile(`^/Book/[0-9]{1,8}/[0-9]{1,12}/$`)
var chapterPathPattern = regexp.MustCompile(`^/Book/[0-9]{1,8}/[0-9]{1,12}/[1-9][0-9]{0,15}\.html$`)

type sourceBook struct {
	BookPath string `json:"bookPath"`
	Title    string `json:"title"`
	Author   string `json:"author"`
	Latest   string `json:"latest"`
}
type sourceChapter struct {
	Path  string `json:"path"`
	Title string `json:"title"`
}
type sourceCatalog struct {
	sourceBook
	Intro    string          `json:"intro"`
	Chapters []sourceChapter `json:"chapters"`
	Warning  string          `json:"warning,omitempty"`
}
type sourceSearch struct {
	Books   []sourceBook `json:"books"`
	Page    int          `json:"page"`
	HasNext bool         `json:"hasNext"`
}
type sourceText struct {
	Path    string `json:"path"`
	Title   string `json:"title"`
	Text    string `json:"text"`
	Cached  bool   `json:"cached"`
	Warning string `json:"warning,omitempty"`
}

func onlineID(path string) string {
	return "biquge001-" + strings.ReplaceAll(strings.Trim(path, "/"), "/", "-")
}
func validChapter(bookPath, chapterPath string) bool {
	return chapterPathPattern.MatchString(chapterPath) && strings.HasPrefix(chapterPath, bookPath)
}
func (s *store) onlineDir(path string) string { return filepath.Join(s.dir, "online", onlineID(path)) }

// 只接受已适配的同站页面；网页里的 HTTP 链接和重定向也升级到 HTTPS。
func sourceURL(raw string) (*url.URL, error) {
	base, _ := url.Parse(sourceOrigin + "/")
	u, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("网站地址无效")
	}
	u = base.ResolveReference(u)
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host != "www.biquge001.com" || u.User != nil || u.Fragment != "" || (u.Path != searchPath && !bookPathPattern.MatchString(u.Path) && !chapterPathPattern.MatchString(u.Path)) || u.RawPath != "" {
		return nil, errors.New("只支持笔趣阁的搜索、目录和章节地址")
	}
	u.Scheme = "https"
	return u, nil
}

func (s *store) fetchPage(raw string) (*html.Node, string, error) {
	u, err := sourceURL(raw)
	if err != nil {
		return nil, "", err
	}
	client := http.Client{Timeout: 10 * time.Second}
	if s.client != nil {
		client = *s.client
		client.Timeout = 10 * time.Second
	}
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("网站重定向次数过多")
		}
		checked, err := sourceURL(req.URL.String())
		if err == nil {
			req.URL = checked
		}
		return err
	}
	req, _ := http.NewRequest(http.MethodGet, u.String(), nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 waitWork/0.5")
	req.Header.Set("Referer", sourceOrigin+"/")
	res, err := client.Do(req)
	if err != nil {
		return nil, "", errors.New("无法连接书源，请检查网络后重试")
	}
	defer res.Body.Close()
	if res.StatusCode == 429 || res.StatusCode == 403 {
		return nil, "", errors.New("书源限制访问，请稍后重试")
	}
	if res.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("书源暂不可用（HTTP %d），请稍后重试", res.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, onlinePageLimit+1))
	if err != nil {
		return nil, "", errors.New("读取网页失败，请重试")
	}
	if len(data) > onlinePageLimit {
		return nil, "", errors.New("网页内容过大，无法解析")
	}
	decoded, err := charset.NewReader(bytes.NewReader(data), res.Header.Get("Content-Type"))
	if err != nil {
		return nil, "", errors.New("网页编码无法识别")
	}
	doc, err := html.Parse(decoded)
	if err != nil {
		return nil, "", errors.New("网页解析失败，请稍后重试")
	}
	return doc, res.Request.URL.Path, err
}

func attr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val
		}
	}
	return ""
}
func nodes(root *html.Node, match func(*html.Node) bool) []*html.Node {
	var found []*html.Node
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n == nil {
			return
		}
		if n.Type == html.ElementNode && match(n) {
			found = append(found, n)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	return found
}
func element(root *html.Node, key, value string) *html.Node {
	all := nodes(root, func(n *html.Node) bool { return attr(n, key) == value })
	if len(all) == 0 {
		return nil
	}
	return all[0]
}
func tag(root *html.Node, name string) *html.Node {
	all := nodes(root, func(n *html.Node) bool { return n.Data == name })
	if len(all) == 0 {
		return nil
	}
	return all[0]
}
func plainText(root *html.Node, clean bool) string {
	var text strings.Builder
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n == nil {
			return
		}
		if n.Type == html.TextNode {
			text.WriteString(n.Data)
			return
		}
		if n.Type != html.ElementNode {
			return
		}
		switch n.Data {
		case "script", "style", "iframe", "noscript", "form", "img":
			return
		}
		if clean && ((n.Data == "a" && strings.TrimSpace(plainText(n, false)) == "www.biquge001.com") || strings.Contains(strings.ToLower(attr(n, "class")), "advert")) {
			return
		}
		if n.Data == "br" || n.Data == "p" || n.Data == "div" {
			text.WriteByte('\n')
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
		if n.Data == "p" || n.Data == "div" {
			text.WriteByte('\n')
		}
	}
	walk(root)
	var lines []string
	for _, line := range strings.Split(strings.ReplaceAll(text.String(), "\r", ""), "\n") {
		line = strings.TrimSpace(strings.ReplaceAll(line, "\x00", ""))
		if line == "" || (clean && strings.HasPrefix(line, "笔趣阁 最新永久域名：")) {
			continue
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n")
}

func parseCatalog(doc *html.Node, path string) (sourceCatalog, error) {
	info := element(doc, "id", "info")
	list := element(doc, "id", "list")
	result := sourceCatalog{sourceBook: sourceBook{BookPath: path, Title: plainText(tag(info, "h1"), false)}, Intro: plainText(element(doc, "id", "intro"), false), Chapters: []sourceChapter{}}
	if info == nil || list == nil || result.Title == "" {
		return result, errors.New("小说目录解析失败，网站结构可能已变化")
	}
	for _, p := range nodes(info, func(n *html.Node) bool { return n.Data == "p" }) {
		text := strings.Join(strings.Fields(plainText(p, false)), "")
		if strings.HasPrefix(text, "作者：") {
			result.Author = strings.TrimPrefix(text, "作者：")
		}
		if strings.HasPrefix(text, "最新章节：") {
			result.Latest = strings.TrimPrefix(text, "最新章节：")
		}
	}
	seen := map[string]bool{}
	for _, a := range nodes(list, func(n *html.Node) bool { return n.Data == "a" }) {
		u, err := sourceURL(resolveLink(path, attr(a, "href")))
		title := plainText(a, false)
		if err != nil || !validChapter(path, u.Path) || seen[u.Path] || title == "" {
			continue
		}
		seen[u.Path] = true
		result.Chapters = append(result.Chapters, sourceChapter{Path: u.Path, Title: title})
	}
	if len(result.Chapters) == 0 {
		return result, errors.New("没有可阅读的章节，请稍后刷新目录")
	}
	return result, nil
}
func resolveLink(base, link string) string {
	u, _ := url.Parse(sourceOrigin + base)
	v, err := url.Parse(link)
	if err != nil {
		return ""
	}
	return u.ResolveReference(v).String()
}
func parseSearch(doc *html.Node, finalPath string, page int) (sourceSearch, error) {
	result := sourceSearch{Books: []sourceBook{}, Page: page}
	if bookPathPattern.MatchString(finalPath) {
		catalog, err := parseCatalog(doc, finalPath)
		if err == nil {
			result.Books = append(result.Books, catalog.sourceBook)
		}
		return result, err
	}
	table := element(doc, "class", "grid")
	if table == nil {
		return result, errors.New("搜索结果解析失败，书源可能暂时限制访问")
	}
	seen := map[string]bool{}
	for _, row := range nodes(table, func(n *html.Node) bool { return n.Data == "tr" }) {
		cells := nodes(row, func(n *html.Node) bool { return n.Data == "td" })
		if len(cells) < 3 {
			continue
		}
		a := tag(cells[0], "a")
		if a == nil {
			continue
		}
		u, err := sourceURL(resolveLink(searchPath, attr(a, "href")))
		if err != nil || !bookPathPattern.MatchString(u.Path) || seen[u.Path] {
			continue
		}
		seen[u.Path] = true
		result.Books = append(result.Books, sourceBook{BookPath: u.Path, Title: plainText(a, false), Author: plainText(cells[2], false), Latest: plainText(cells[1], false)})
	}
	for _, a := range nodes(element(doc, "id", "pagelink"), func(n *html.Node) bool { return n.Data == "a" }) {
		u, err := sourceURL(resolveLink(searchPath, attr(a, "href")))
		if err == nil && u.Path == searchPath {
			p, _ := strconv.Atoi(u.Query().Get("page"))
			if p > page {
				result.HasNext = true
			}
		}
	}
	return result, nil
}
func parseChapter(doc *html.Node, path string) (sourceText, error) {
	result := sourceText{Path: path, Title: plainText(tag(element(doc, "class", "bookname"), "h1"), false), Text: plainText(element(doc, "id", "content"), true)}
	if result.Title == "" || result.Text == "" {
		return result, errors.New("章节正文解析失败，请稍后重试")
	}
	return result, nil
}

func (s *store) handleSource(method string, raw json.RawMessage) (any, *dbx.PluginError) {
	fail := func(err error) (any, *dbx.PluginError) { return nil, dbx.NewError(-32000, err.Error()) }
	var p struct {
		Query       string `json:"query"`
		Page        int    `json:"page"`
		BookPath    string `json:"bookPath"`
		ChapterPath string `json:"chapterPath"`
		Refresh     bool   `json:"refresh"`
	}
	if len(raw) > 4096 || json.Unmarshal(raw, &p) != nil {
		return nil, dbx.NewError(-32602, "书源请求无效")
	}
	if method == "source/search" {
		p.Query = strings.TrimSpace(p.Query)
		if p.Query == "" || len([]rune(p.Query)) > 100 || p.Page < 1 || p.Page > 10000 {
			return nil, dbx.NewError(-32602, "请输入有效的搜索词和页码")
		}
		encoded, err := simplifiedchinese.GBK.NewEncoder().String(p.Query)
		if err != nil {
			return fail(errors.New("搜索词包含书源不支持的字符，请使用中文或英文"))
		}
		doc, path, err := s.fetchPage(searchPath + "?searchkey=" + url.QueryEscape(encoded) + "&page=" + strconv.Itoa(p.Page))
		if err != nil {
			return fail(err)
		}
		result, err := parseSearch(doc, path, p.Page)
		if err != nil {
			return fail(err)
		}
		return result, nil
	}
	if method != "source/catalog" && method != "source/chapter" {
		return nil, dbx.MethodNotFound(method)
	}
	if !bookPathPattern.MatchString(p.BookPath) || (method == "source/chapter" && !validChapter(p.BookPath, p.ChapterPath)) {
		return nil, dbx.NewError(-32602, "小说或章节地址无效")
	}
	name, path := "catalog.json", p.BookPath
	if method == "source/chapter" {
		name = filepath.Base(p.ChapterPath) + ".json"
		path = p.ChapterPath
	}
	cachePath := filepath.Join(s.onlineDir(p.BookPath), name)
	s.mu.Lock()
	epoch := s.onlineEpoch[p.BookPath]
	data, cacheErr := os.ReadFile(cachePath)
	s.mu.Unlock()
	if cacheErr == nil && !p.Refresh {
		if method == "source/catalog" {
			var cached sourceCatalog
			if json.Unmarshal(data, &cached) == nil && cached.BookPath == p.BookPath && len(cached.Chapters) > 0 {
				return cached, nil
			}
		} else {
			var cached sourceText
			if json.Unmarshal(data, &cached) == nil && cached.Path == p.ChapterPath && cached.Text != "" {
				cached.Cached = true
				return cached, nil
			}
		}
	}
	doc, finalPath, err := s.fetchPage(path)
	if err != nil {
		return fail(err)
	}
	if finalPath != path {
		return fail(errors.New("书源返回了其他页面，请刷新目录后重试"))
	}
	var result any
	if method == "source/catalog" {
		result, err = parseCatalog(doc, path)
	} else {
		result, err = parseChapter(doc, path)
	}
	if err != nil {
		return fail(err)
	}
	data, err = json.Marshal(result)
	if err != nil {
		return fail(err)
	}
	if len(data) > onlinePageLimit {
		return fail(errors.New("解析内容过大，无法加载该页面"))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// 删除书籍会改变代次，阻止先前发出的请求重新生成已删除的缓存。
	if epoch != s.onlineEpoch[p.BookPath] {
		return fail(errors.New("书籍已移除，请重新选择"))
	}
	err = writeAtomic(cachePath, data)
	if method == "source/catalog" {
		catalog := result.(sourceCatalog)
		if err != nil {
			catalog.Warning = "目录尚未缓存，离线时可能无法恢复，请检查磁盘后刷新目录。"
		}
		return catalog, nil
	}
	chapter := result.(sourceText)
	chapter.Cached = err == nil
	if err != nil {
		chapter.Warning = "正文尚未缓存，离线时无法阅读本章，请检查磁盘后重试。"
	}
	return chapter, nil
}
