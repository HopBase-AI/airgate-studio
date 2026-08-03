package studio

import (
	"net/http/httptest"
	"testing"
)

func TestParseProjectID(t *testing.T) {
	cases := []struct {
		path   string
		wantID int64
		wantOK bool
	}{
		{"/projects/123", 123, true},
		{"/projects/123/assets", 123, true},
		{"/projects/1/assets?limit=20&offset=0", 1, true},
		{"/projects/", 0, false},
		{"/projects/abc", 0, false},
		{"/projects/0", 0, false},
		{"/projects/-5", 0, false},
		{"/projects/12/assets/extra", 12, true},
	}
	for _, c := range cases {
		req := httptest.NewRequest("GET", c.path, nil)
		gotID, gotOK := parseProjectID(req)
		if gotID != c.wantID || gotOK != c.wantOK {
			t.Errorf("parseProjectID(%q) = (%d, %v), want (%d, %v)", c.path, gotID, gotOK, c.wantID, c.wantOK)
		}
	}
}

func TestDefaultProjectLockKeyStable(t *testing.T) {
	// 同一 userID 必须得到稳定 key（advisory lock 依赖此性质），不同 userID 应不同。
	first := defaultProjectLockKey(42)
	if first != defaultProjectLockKey(42) {
		t.Error("lock key 对同一 userID 不稳定")
	}
	if defaultProjectLockKey(1) == defaultProjectLockKey(2) {
		t.Error("lock key 对不同 userID 发生碰撞")
	}
}
