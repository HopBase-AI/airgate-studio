package studio

import (
	"strings"
	"testing"
)

func TestValidateVideoModelParamsFollowsOfficialSpecs(t *testing.T) {
	cases := []struct {
		name    string
		model   string
		params  map[string]interface{}
		wantErr string
	}{
		{name: "kling v2.6 5s", model: "kling-v2-6", params: map[string]interface{}{"duration": float64(5), "resolution": "720p"}},
		{name: "kling v2.6 10s", model: "kling-v2-6", params: map[string]interface{}{"duration": float64(10)}},
		{name: "kling v2.6 7s rejected", model: "kling-v2-6", params: map[string]interface{}{"duration": float64(7)}, wantErr: "does not support a 7-second duration"},
		{name: "kling v3 keeps 3-15", model: "kling-v3", params: map[string]interface{}{"duration": float64(7)}},
		{name: "sd2.0 auto duration and adaptive ratio", model: videoModelSeedanceMiniOverseas, params: map[string]interface{}{"duration": float64(-1), "ratio": "adaptive"}},
		{name: "sd2.0 21:9 with 12s", model: videoModelSeedanceStandardDomestic, params: map[string]interface{}{"duration": float64(12), "ratio": "21:9"}},
		{name: "sd2.0 unknown ratio rejected", model: videoModelSeedanceFastOverseas, params: map[string]interface{}{"ratio": "3:2"}, wantErr: "does not support aspect ratio 3:2"},
		{name: "sd2.5 unknown ratio rejected", model: videoModelSeedance25, params: map[string]interface{}{"ratio": "2:3"}, wantErr: "does not support aspect ratio 2:3"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateVideoModelParams(tc.model, tc.params)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want contains %q", err, tc.wantErr)
			}
		})
	}
}

func TestValidateReferenceResolutionCapsGrokReferenceToVideo(t *testing.T) {
	images := []generationInput{{Type: "image", Role: "reference_image", URL: "https://cdn.example.com/a.png"}}
	if err := validateReferenceResolution("grok-imagine-video-1.5", map[string]interface{}{"resolution": "1080p"}, images); err == nil || !strings.Contains(err.Error(), "720p") {
		t.Fatalf("grok + reference image + 1080p error = %v", err)
	}
	for _, resolution := range []string{"720p", "480p", ""} {
		if err := validateReferenceResolution("grok-imagine-video-1.5", map[string]interface{}{"resolution": resolution}, images); err != nil {
			t.Fatalf("grok + reference image + %q rejected: %v", resolution, err)
		}
	}
	if err := validateReferenceResolution("grok-imagine-video-1.5", map[string]interface{}{"resolution": "1080p"}, nil); err != nil {
		t.Fatalf("grok text-to-video 1080p rejected: %v", err)
	}
	if err := validateReferenceResolution(videoModelSeedance25, map[string]interface{}{"resolution": "720p"}, images); err != nil {
		t.Fatalf("models without the cap must pass: %v", err)
	}
}
