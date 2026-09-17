import { describe, expect, it } from 'vitest';

import {
  SPEECH_MODEL_REGISTRY,
  SPEECH_STRINGS,
  SPEECH_VOICES,
  SPEECH_VOICE_LANGUAGES,
  clampSpeechSpeed,
  countCodePoints,
  defaultSpeechVoiceFor,
  formatAudioDuration,
  speechBillableCharacters,
  speechLanguageBoostFor,
  speechStringsFor,
  speechVoiceChipKey,
  speechVoiceLanguageKey,
} from './speechConfig';

describe('speech registry', () => {
  it('lists exactly the two Speech 2.8 models with exact IDs', () => {
    expect(SPEECH_MODEL_REGISTRY.map(model => model.id)).toEqual(['speech-2.8-hd', 'speech-2.8-turbo']);
    expect(SPEECH_MODEL_REGISTRY.every(model => model.platform === 'minimax')).toBe(true);
  });

  // 音色 ID 是上游契约的一部分：大小写、空格、括号都不能改。整表钉死，防止“顺手规范化”。
  it('keeps the curated voice IDs verbatim from the official list', () => {
    expect(SPEECH_VOICES.map(voice => voice.id)).toEqual([
      'English_expressive_narrator',
      'English_radiant_girl',
      'English_magnetic_voiced_man',
      'English_compelling_lady1',
      'English_Aussie_Bloke',
      'English_captivating_female1',
      'English_Upbeat_Woman',
      'English_Trustworth_Man',
      'Chinese (Mandarin)_Reliable_Executive',
      'Chinese (Mandarin)_News_Anchor',
      'Chinese (Mandarin)_Unrestrained_Young_Man',
      'Chinese (Mandarin)_Mature_Woman',
      'Arrogant_Miss',
      'Robot_Armor',
      'Chinese (Mandarin)_Kind-hearted_Antie',
      'Chinese (Mandarin)_HK_Flight_Attendant',
      'Japanese_IntellectualSenior',
      'Japanese_DecisivePrincess',
      'Japanese_LoyalKnight',
      'Spanish_SereneWoman',
      'Spanish_MaturePartner',
      'Spanish_CaptivatingStoryteller',
      'Cantonese_GentleLady',
    ]);
    const counts = Object.fromEntries(SPEECH_VOICE_LANGUAGES.map(lang => [lang, SPEECH_VOICES.filter(v => v.language === lang).length]));
    expect(counts).toEqual({ en: 8, zh: 8, ja: 3, es: 3, yue: 1 });
    expect(new Set(SPEECH_VOICES.map(voice => voice.id)).size).toBe(SPEECH_VOICES.length);
  });

  it('adds the Cantonese language boost only for Cantonese voices', () => {
    expect(speechLanguageBoostFor('Cantonese_GentleLady')).toBe('Chinese,Yue');
    expect(speechLanguageBoostFor('Chinese (Mandarin)_News_Anchor')).toBeUndefined();
  });
});

describe('speech text accounting', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(countCodePoints('Hello, world.')).toBe(13);
    expect(countCodePoints('你好')).toBe(2);
    expect(countCodePoints('😀')).toBe(1);
  });

  it('bills Han characters twice, everything else once', () => {
    expect(speechBillableCharacters('Hello, world.')).toBe(13);
    expect(speechBillableCharacters('你好')).toBe(4);
    expect(speechBillableCharacters('你好, world')).toBe(11);
    expect(speechBillableCharacters('')).toBe(0);
  });

  it('picks the Mandarin default voice for Han text and the English one otherwise', () => {
    expect(defaultSpeechVoiceFor('你好，世界')).toBe('Chinese (Mandarin)_News_Anchor');
    expect(defaultSpeechVoiceFor('Hello there')).toBe('English_expressive_narrator');
    expect(defaultSpeechVoiceFor('こんにちは 漢字')).toBe('Chinese (Mandarin)_News_Anchor');
  });

  it('clamps speed to the official range at one decimal', () => {
    expect(clampSpeechSpeed(0.1)).toBe(0.5);
    expect(clampSpeechSpeed(3)).toBe(2);
    expect(clampSpeechSpeed(1.25)).toBe(1.3);
    expect(clampSpeechSpeed(Number.NaN)).toBe(1);
  });

  it('formats durations as m:ss', () => {
    expect(formatAudioDuration(0)).toBe('--:--');
    expect(formatAudioDuration(400)).toBe('0:01');
    expect(formatAudioDuration(65_000)).toBe('1:05');
  });
});

describe('speech strings', () => {
  it('keeps the same key set across the five languages', () => {
    const zhKeys = Object.keys(SPEECH_STRINGS.zh).sort();
    for (const lang of ['en', 'ja', 'zh-HK', 'es'] as const) {
      expect(Object.keys(SPEECH_STRINGS[lang]).sort()).toEqual(zhKeys);
    }
  });

  // 语言 chip 只是按配音员母语筛选；缺了这行说明，用户会以为切语言=翻译文本
  // （2026-09-16：选了 Spanish_CaptivatingStoryteller 念中文文案，以为功能坏了）。
  it('ships a non-empty disambiguation hint for the voice language filter in all five languages', () => {
    // 说明退居兜底后仍有长度上限：弹层只有 320px 宽，超了就从一行涨成两行。
    const maxChars = { zh: 30, en: 64, ja: 30, 'zh-HK': 30, es: 64 } as const;
    for (const lang of ['zh', 'en', 'ja', 'zh-HK', 'es'] as const) {
      expect(SPEECH_STRINGS[lang].voice_lang_filter.trim().length).toBeGreaterThan(0);
      // 说明要真的解释清楚，一两个词糊弄不过去。
      expect(SPEECH_STRINGS[lang].voice_lang_hint.trim().length).toBeGreaterThan(20);
      expect([...SPEECH_STRINGS[lang].voice_lang_hint.trim()].length).toBeLessThanOrEqual(maxChars[lang]);
    }
  });

  // 芯片挂在「音色」标题正下方，写裸语言名会被读成「输出这门语言」——芯片文案必须自带
  // 「音色」二字；列表每行右侧的短标签紧挨音色名，反过来必须保持裸语言名（2026-09-16）。
  it('spells out "voice" in every filter chip and keeps the row labels bare', () => {
    const voiceWord = { zh: '音色', en: 'voices', ja: '音声', 'zh-HK': '音色', es: 'voces' } as const;
    for (const lang of ['zh', 'en', 'ja', 'zh-HK', 'es'] as const) {
      const dict = SPEECH_STRINGS[lang];
      const chips = [dict.voice_lang_chip_all, ...SPEECH_VOICE_LANGUAGES.map(l => dict[speechVoiceChipKey(l)])];
      for (const chip of chips) expect(chip.toLowerCase()).toContain(voiceWord[lang]);
      for (const l of SPEECH_VOICE_LANGUAGES) {
        expect(dict[speechVoiceLanguageKey(l)].toLowerCase()).not.toContain(voiceWord[lang]);
      }
    }
  });

  it('never mentions supply-side vocabulary in user-facing copy', () => {
    for (const lang of ['zh', 'en', 'ja', 'zh-HK', 'es'] as const) {
      for (const value of Object.values(SPEECH_STRINGS[lang])) {
        expect(value).not.toMatch(/账号|通道|上游|帳號|通路|account|channel|upstream/i);
      }
    }
  });

  it('interpolates placeholders and resolves the dictionary by UI language', () => {
    expect(speechStringsFor('en')('chars_count', { count: 12, max: '10,000' })).toBe('12 / 10,000 characters');
    expect(speechStringsFor('zh-HK')('media_audio')).toBe('語音');
    expect(speechStringsFor('es')('media_audio')).toBe('Voz');
    expect(speechStringsFor('fr')('media_audio')).toBe('Speech');
  });
});
