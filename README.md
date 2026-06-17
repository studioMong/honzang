# 혼자장부

1인법인 대표가 직접 장부를 정리하고 신고 준비자료를 만들 수 있게 돕는 TypeScript 기반 웹/PWA 앱입니다.

## 기술 스택

- Next.js + React + TypeScript
- Prisma ORM
- Railway Postgres
- PWA 우선 구조
- 모바일 앱은 이후 Capacitor 래핑을 기본 방향으로 검토

## 로컬 실행

```bash
npm install
npm run db:generate
npm run dev
```

DB 없이 실행하면 샘플 데이터 모드로 동작합니다.

## Railway 환경변수

Railway 서비스 Variables에서 Postgres 서비스의 `DATABASE_URL`을 참조 변수로 연결합니다.

필수:

```bash
DATABASE_URL=postgresql://...
NEXT_PUBLIC_APP_URL=https://honzang-production.up.railway.app
```

## 배포

Railway는 GitHub 저장소를 연결한 뒤 다음 설정을 사용합니다.

- Build: `npm run build`
- Pre-deploy: `npm run db:deploy`
- Start: `npm run start`
- Healthcheck: `/api/health`

루트에 정적 `index.html`을 두면 Railway가 정적 사이트로 감지할 수 있으므로, 참고용 HTML 문서는 `attachments/` 아래에 보관합니다.

배포 후 확인:

- `/api/health`: 앱 서버와 DB 연결 상태
- `/api/version`: 앱 버전과 Railway 커밋 메타데이터

## MVP 범위

- 회사 기본 설정
- 1인법인 필수정보 상태 체크
- 설치형 PWA 기본 지원
- 통장/카드/홈택스/PG CSV 업로드
- 최근 CSV 업로드 이력 확인
- CSV 업로드 배치 되돌리기
- CSV 컬럼 매핑
- CSV 파일 해시 기반 중복 업로드 방지
- 거래 자동 분류 초안
- 사용자 자동 분류 규칙
- 계정과목 수동 확정
- 증빙 상태 관리
- 증빙-거래 추천 매칭
- 검토함
- 월별 손익, 부가세 준비, 위험거래 리포트
- 신고 일정과 신고 준비 순서 안내

## CSV 샘플 제공 방식

실제 은행/카드/홈택스에서 내려받은 CSV를 사용합니다. 계좌번호, 사업자번호, 거래처명, 카드번호는 마스킹해도 됩니다. 중요한 것은 실제 컬럼 구조를 유지하는 것입니다.

앱의 업로드 화면에서 자료 유형별 샘플 CSV를 내려받을 수 있습니다. 저장소 기준 샘플 파일은 `public/samples/`에 있습니다.

샘플 CSV가 현재 컬럼 자동 매핑과 정규화 로직을 통과하는지는 아래 명령으로 확인합니다.

```bash
npm run verify:samples
```

## 웹/앱 지원

혼자장부는 Next.js 웹앱으로 실행하며, `manifest.webmanifest`와 service worker를 통해 설치형 PWA 기본 동작을 지원합니다. 네트워크가 끊긴 상태에서 앱 화면 이동이 실패하면 `public/offline.html`을 표시합니다.

DB 연결 모드에서는 거래/증빙이 0건이어도 샘플 데이터로 대체하지 않습니다. CSV를 여러 번 가져오면 새 배치를 기존 화면 상태와 병합합니다.
