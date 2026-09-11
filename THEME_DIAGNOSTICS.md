# MARKET FLOW Theme Diagnostics

- Last check: `2026-09-11 04:59:52 UTC`
- App deployed commit: `17a9ecacc8f5fac6b85432a41e6605406cb1d4e1`
- Local theme-flow API: `online`

- API ok: `true`
- API updatedAt: `2026-09-11T05:00:09.946Z`
- cache pendingGapSymbols: `0`

## 현재 5개 테마 장중 커버리지

- **금융**: day=`2026-09-11`, points=`121`, first=`08:00`, last=`14:00`, openingDelay=`0m`, maxGap=`3m`
  - members: KB금융(105560), 신한지주(055550), 삼성화재(000810)
- **조선**: day=`2026-09-11`, points=`121`, first=`08:00`, last=`14:00`, openingDelay=`0m`, maxGap=`3m`
  - members: HD현대중공업(329180), 한화오션(042660), HD현대마린솔루션(443060)
- **원전**: day=`2026-09-11`, points=`121`, first=`08:00`, last=`14:00`, openingDelay=`0m`, maxGap=`3m`
  - members: 한전기술(052690), 두산에너빌리티(034020), 우리기술(032820)
- **광통신**: day=`2026-09-11`, points=`101`, first=`09:00`, last=`14:00`, openingDelay=`0m`, maxGap=`3m`
  - members: 우리로(046970), 빛과전자(069540)
- **반도체**: day=`2026-09-11`, points=`121`, first=`08:00`, last=`14:00`, openingDelay=`0m`, maxGap=`3m`
  - members: SK하이닉스(000660), 삼성전자(005930), 삼성전기(009150), 한미반도체(042700), 주성엔지니어링(036930), LG이노텍(011070), DB하이텍(000990), 심텍(222800), 원익IPS(240810)

이 파일은 Raspberry Pi의 실제 `/api/market/theme-flow` 응답을 기준으로 테마 차트의 장중 시작 시각과 최대 데이터 공백을 기록합니다.
