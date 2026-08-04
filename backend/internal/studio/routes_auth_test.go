package studio

import (
	"net/http"
	"net/http/httptest"
	"testing"

	sdk "github.com/DouDOU-start/airgate-sdk/sdkgo"
)

type recordingRouteRegistrar struct {
	prefix   string
	handlers map[string]http.HandlerFunc
}

func newRecordingRouteRegistrar() *recordingRouteRegistrar {
	return &recordingRouteRegistrar{handlers: make(map[string]http.HandlerFunc)}
}

func (r *recordingRouteRegistrar) Handle(method, path string, handler http.HandlerFunc) {
	r.handlers[method+" "+r.prefix+path] = handler
}

func (r *recordingRouteRegistrar) Group(prefix string) sdk.RouteRegistrar {
	return &recordingRouteRegistrar{prefix: r.prefix + prefix, handlers: r.handlers}
}

func TestGenerationRoutesRequirePositiveUserIdentity(t *testing.T) {
	registrar := newRecordingRouteRegistrar()
	registerRoutes(&StudioPlugin{}, registrar)

	routes := []string{
		http.MethodPost + " /generation-tasks",
		http.MethodGet + " /generation-tasks",
		http.MethodGet + " /generation-tasks/",
		http.MethodDelete + " /generation-tasks/",
	}
	invalidIDs := []string{"", "0", "-1", "not-a-number"}

	for _, route := range routes {
		handler := registrar.handlers[route]
		if handler == nil {
			t.Fatalf("route %q was not registered", route)
		}
		for _, userID := range invalidIDs {
			t.Run(route+"/user="+userID, func(t *testing.T) {
				req := httptest.NewRequest(http.MethodGet, "/", nil)
				if userID != "" {
					req.Header.Set(headerUserID, userID)
				}
				recorder := httptest.NewRecorder()

				handler(recorder, req)

				if recorder.Code != http.StatusUnauthorized {
					t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusUnauthorized, recorder.Body.String())
				}
			})
		}
	}
}

func TestRequireUserAllowsPositiveIdentity(t *testing.T) {
	called := false
	handler := (&StudioPlugin{}).requireUser(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusNoContent)
	})
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(headerUserID, "42")
	recorder := httptest.NewRecorder()

	handler(recorder, req)

	if !called {
		t.Fatal("wrapped handler was not called")
	}
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNoContent)
	}
}

func TestProjectRoutesRejectInvalidIdentityBeforeConfigurationCheck(t *testing.T) {
	handler := (&StudioPlugin{}).requireProjectService(func(http.ResponseWriter, *http.Request) {
		t.Fatal("wrapped handler must not be called")
	})
	recorder := httptest.NewRecorder()

	handler(recorder, httptest.NewRequest(http.MethodGet, "/projects", nil))

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d; body=%s", recorder.Code, http.StatusUnauthorized, recorder.Body.String())
	}
}
