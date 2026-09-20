package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strings"
)

// 仅识别旧版书籍与缓存，不作为新请求或新设置的默认网址。
const legacySourceOrigin = "https://www.biquge001.com"

var sourceLabelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

func normalizeSourceOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", errors.New("书源网址无效，请填写 HTTPS 网站首页")
	}
	host := strings.ToLower(u.Hostname())
	if u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.RawPath != "" || (u.Port() != "" && u.Port() != "443") || len(host) > 253 || !strings.Contains(host, ".") || net.ParseIP(host) != nil || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return "", errors.New("请填写公网网站的 HTTPS 首页地址，不含账号、端口、路径或查询参数")
	}
	for _, label := range strings.Split(host, ".") {
		if !sourceLabelPattern.MatchString(label) {
			return "", errors.New("网站域名无效")
		}
	}
	return "https://" + host, nil
}

func bookOrigin(b book) string {
	if b.SourceOrigin == "" {
		return legacySourceOrigin
	}
	return b.SourceOrigin
}
func sourceCacheKey(origin, path string) string {
	if origin == legacySourceOrigin {
		return onlineID(path)
	}
	return fmt.Sprintf("%x-%s", sha256.Sum256([]byte(origin)), onlineID(path))
}
