# Eğitim Stüdyosu

Konu doğal dille yazılır; Claude içeriği hazırlar, kullanıcı onaylar; Claude sahne animasyonlarını çizer, kullanıcı önizleyip onaylar; ElevenLabs seslendirir; GitHub Actions videoyu kare kare çizip 1080×1920 / 60 FPS MP4 olarak teslim eder.

## Akış

| Durum | Ne olur |
| --- | --- |
| content_generating → content_review | Claude sahneleri ve altyazı cümlelerini yazar. Onayla / Düzelt / İptal. |
| visuals_generating → visuals_review | Claude her sahne için Canvas kodu yazar. Tarayıcıda önizleme, sahne bazında düzeltme. |
| voicing | ElevenLabs zaman damgalı TTS; sahne süreleri ve altyazı zamanları sese göre hesaplanır. |
| rendering | `render.yml` iş akışı GitHub Actions'ta çalışır, MP4'ü Supabase Storage'a yükler. |
| delivered | Video oynatılır ve indirilir. |

## Bileşenler

- `server.js` — bağımlılıksız Node 20+ sunucu (API + arayüz).
- `lib/` — Supabase REST, Claude, ElevenLabs yardımcıları.
- `public/engine.js` — çizim kütüphanesi + oynatıcı (önizleme ve render aynı dosyayı kullanır).
- `render/` — GitHub Actions render işçisi (Playwright + ffmpeg).
- Supabase projesi: `egitim-video` (tablolar: projects, versions, audio_tracks, render_jobs, usage; depo: `media`, özel).

## Render ortam değişkenleri

| Değişken | Açıklama |
| --- | --- |
| `APP_PASSWORD` | Uygulamaya giriş şifresi |
| `SUPABASE_URL` | `https://vymygihoivdfliunmbdo.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API Keys → secret (service_role) anahtarı |
| `ANTHROPIC_API_KEY` | Claude API anahtarı |
| `CLAUDE_MODEL` | İsteğe bağlı, varsayılan `claude-opus-5-5` |
| `ELEVENLABS_API_KEY` | ElevenLabs anahtarı |
| `ELEVENLABS_VOICE_ID` | Varsayılan ses kimliği |
| `ELEVENLABS_MODEL` | İsteğe bağlı, varsayılan `eleven_multilingual_v2` |
| `GITHUB_TOKEN` | Bu depoda Actions: Read and write izinli ince ayarlı (fine-grained) token |
| `GITHUB_REPO` | İsteğe bağlı, varsayılan `onurcoskun616/egitimapi` |

GitHub tarafında gizli değer gerekmez: render işi, tek kullanımlık jetonla uygulamadan paketi alır ve videoyu imzalı bağlantıyla yükler.
