package main

import (
	"net/http"
	"testing"
)

func TestSourceConfigurationAndCacheIsolation(t *testing.T) {
	s, requests := fixtureStore(t)
	for _, params := range []map[string]any{
		{"query": "神秘", "page": 1},
		{"origin": legacySourceOrigin, "query": "神秘", "page": 1},
	} {
		if _, err := call(t, s, "source/search", params); err == nil {
			t.Fatal("unconfigured search allowed")
		}
	}
	if requests.Load() != 0 {
		t.Fatal("unexpected network")
	}
	params := map[string]any{"origin": legacySourceOrigin, "bookPath": testBookPath, "chapterPath": testChapterPath, "allowNetwork": true}
	if _, err := call(t, s, "source/chapter", params); err != nil {
		t.Fatal(err)
	}
	params["allowNetwork"] = false
	if _, err := call(t, s, "source/chapter", params); err != nil {
		t.Fatal(err)
	}
	params["origin"] = "https://other.example.com"
	if _, err := call(t, s, "source/chapter", params); err == nil {
		t.Fatal("cache leaked across origins")
	}
	if requests.Load() != 1 {
		t.Fatal("cache-only request used network")
	}
	params["allowNetwork"] = true
	s.client = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "other.example.com" {
			t.Errorf("wrong source host: %s", r.URL.Host)
		}
		requests.Add(1)
		return response(r, 200, chapterHTML), nil
	})}
	if _, err := call(t, s, "source/chapter", params); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 2 {
		t.Fatal("new source did not fetch independently")
	}
	if _, err := sourceURL("https://other.example.com", legacySourceOrigin+testChapterPath); err == nil {
		t.Fatal("cross-origin link allowed")
	}
}
func TestSourceAddressValidation(t *testing.T) {
	for _, raw := range []string{"", "http://example.com", "https://127.0.0.1", "https://x.local", "https://user@example.com", "https://example.com/path", "https://example.com?x=1", "https://example.com:8080"} {
		if _, err := normalizeSourceOrigin(raw); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}
