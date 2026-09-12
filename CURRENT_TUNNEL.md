# MARKET FLOW 현재 접속 주소

- 상태: `online`
- 갱신 시각: `2026-09-12 00:59:33 UTC`
- Raspberry Pi tunnel service: `active` (`docker`)

## 접속

**[https://venice-border-singh-develops.trycloudflare.com](https://venice-border-singh-develops.trycloudflare.com)**

이 파일은 Raspberry Pi가 5분마다 Cloudflare Quick Tunnel 주소를 확인해 자동 갱신합니다. systemd 재시작 권한이 없으면 user 서비스, 그래도 안 되면 Docker 기반 fallback 터널을 자동 사용합니다.
