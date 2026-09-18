# MARKET FLOW Theme Diagnostics

- Last check: `2026-09-18 19:48:39 UTC`
- App deployed commit: `056f41f3e3b9d24d93289c8ef8b7e03b8a628fc2`
- Local theme-flow API: `online`

- API ok: `true`
- API updatedAt: `2026-09-18T19:46:51.616Z`
- cache pendingGapSymbols: `0`

## 현재 5개 테마 장중 커버리지

- **전력기기**: day=`2026-09-18`, points=`241`, first=`08:00`, last=`20:00`, openingDelay=`0m`, maxGap=`3m`
  - members: 가온전선(000500), 대한전선(001440), LS ELECTRIC(010120), 효성중공업(298040), 산일전기(062040)
- **반도체**: day=`2026-09-18`, points=`241`, first=`08:00`, last=`20:00`, openingDelay=`0m`, maxGap=`3m`
  - members: SK하이닉스(000660), 삼성전자(005930), 삼성전기(009150), 한미반도체(042700), 주성엔지니어링(036930), LG이노텍(011070), DB하이텍(000990)
- **방산**: day=`2026-09-18`, points=`241`, first=`08:00`, last=`20:00`, openingDelay=`0m`, maxGap=`3m`
  - members: RFHIC(218410), 한화에어로스페이스(012450), 한화시스템(272210)
- **원전**: day=`2026-09-18`, points=`241`, first=`08:00`, last=`20:00`, openingDelay=`0m`, maxGap=`3m`
  - members: 두산에너빌리티(034020), 한전기술(052690), 대원전선(006340)
- **금융**: day=`2026-09-18`, points=`230`, first=`08:33`, last=`20:00`, openingDelay=`0m`, maxGap=`3m`
  - members: KB금융(105560), 신한지주(055550), 하나금융지주(086790), 우리금융지주(316140)

이 파일은 Raspberry Pi의 실제 `/api/market/theme-flow` 응답을 기준으로 테마 차트의 장중 시작 시각과 최대 데이터 공백을 기록합니다.
