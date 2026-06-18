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

프로덕션 standalone 서버 경로는 아래 명령으로 확인합니다.

```bash
npm run build
npm run smoke:prod
```

로컬/저장소 기준 MVP 회귀 검증은 아래 명령으로 한 번에 실행합니다. 이 명령은 실제 DB를 변경하지 않으며, production smoke에서 대시보드와 리포트 핵심 UI 문구까지 확인합니다.

```bash
npm run verify:mvp
```

## Railway 환경변수

Railway 서비스 Variables에서 Postgres 서비스의 `DATABASE_URL`을 참조 변수로 연결합니다.

필수:

```bash
DATABASE_URL=postgresql://...
NEXT_PUBLIC_APP_URL=https://honzang-production.up.railway.app
HONZANG_ACCESS_CODE=배포_접근_코드
HONZANG_ACCESS_TOKEN_SALT=쿠키_서명용_긴_랜덤값
HONZANG_FILE_ENCRYPTION_KEY=원본_CSV_증빙_암호화용_긴_랜덤값
```

`HONZANG_ACCESS_CODE`가 설정된 배포 환경에서는 `/access`에서 코드를 입력해야 앱과 장부 API에 접근할 수 있습니다. 프로덕션에서는 `HONZANG_ACCESS_TOKEN_SALT`도 함께 있어야 접근 쿠키를 발급합니다. `/api/health`, `/api/version`, PWA 리소스, 샘플 CSV는 배포 점검과 설치를 위해 공개 상태를 유지합니다. 접근 쿠키는 HTTP-only로 7일간 유지되며, 코드를 바꾸거나 salt를 바꾸면 기존 쿠키는 무효화됩니다. 같은 접속 출처에서 접근코드를 5회 틀리면 10분간 로그인을 제한합니다. DB 연결 환경에서는 접근 성공/실패/잠금/로그아웃, 잘못된 로그인 요청 형식과 잠금 상태 재시도가 감사 로그에 기록되며, 원문 IP와 접근 코드는 저장하지 않고 해시와 상태값만 저장합니다.

`HONZANG_FILE_ENCRYPTION_KEY`가 설정되면 신규 원본 CSV와 DB 보관 증빙 파일은 Railway Postgres에 저장하기 전에 암호화됩니다. 키가 없으면 기존 로컬 개발처럼 평문 저장하지만, 프로덕션 운영 준비 점검에서는 필수 누락으로 표시됩니다. 키를 교체하기 전에는 기존 암호화 파일을 백업 JSON/ZIP으로 내려받아 복구 계획을 먼저 확인해야 합니다.

## 배포

Railway는 GitHub 저장소를 연결한 뒤 다음 설정을 사용합니다.

- Builder: Dockerfile
- Build: `npm run build`
- Pre-deploy: `npm run db:deploy`
- Start: `npm run start`
- Healthcheck: `/api/health`

루트 `Dockerfile`로 Node/Next 서버 빌드를 강제합니다. Railway 배포 로그에서 Dockerfile 빌드가 감지되는지 확인해야 합니다.

루트에 정적 `index.html`을 두면 Railway가 정적 사이트로 감지할 수 있으므로, 참고용 HTML 문서는 `attachments/` 아래에 보관합니다.

배포 후 확인:

- `/api/health`: 앱 서버와 DB 연결 상태
- `/api/version`: 앱 버전과 Railway 커밋 메타데이터
- 설정 화면의 `운영 준비 점검`: Postgres, 접근코드, 공개 앱 URL, Railway 메타데이터 상태

Railway 공개 URL이 최신 Next 서버와 Postgres를 바라보는지는 아래 명령으로 확인합니다.

```bash
npm run verify:deployment-config
npm run verify:railway
```

배포 커밋까지 고정해서 확인하려면 아래처럼 실행합니다.

```bash
RAILWAY_EXPECTED_COMMIT=$(git rev-parse HEAD) npm run verify:railway
```

공개 URL이 실패할 때 원인을 분류하려면 아래 진단을 실행합니다. 정상 배포 게이트는 아니며, 도메인 오연결, 오래된 커밋, DB 미연결, PWA manifest 미노출을 구분해 Railway Dashboard에서 확인할 작업을 출력합니다.

```bash
npm run audit:railway
```

현재 공개 URL이 아직 준비되지 않은 상태에서도 진단 출력만 확인하려면 아래처럼 soft mode로 실행합니다.

```bash
RAILWAY_AUDIT_SOFT=1 npm run audit:railway
```

공개 도메인이 이전 static/legacy 서비스에 연결되어 `/api/version`, `/api/health`, `/manifest.webmanifest`가 404로 응답하면 [Railway 배포 전환 체크리스트](docs/railway-cutover.md)를 따라 도메인 연결 대상 서비스를 최신 Next.js 앱으로 전환합니다.

## 제품 경계

혼자장부는 대표가 직접 장부를 정리하고 신고 준비자료를 만드는 도구입니다. 세무 범위는 신고 준비자료 생성까지입니다. 홈택스 자동 제출, 신고 대행, 세무대리, 절세 자문, 법인세 신고서 자동 확정은 MVP 범위에서 제외합니다. 앱이 보여주는 금액과 표는 신고 전 대조자료이며, 최종 판단과 제출은 사용자가 홈택스와 국세청 공지 기준으로 직접 확인합니다.

## MVP 범위

- 회사 기본 설정
- 1인법인 필수정보 상태 체크
- 회당 정산/SaaS 월·연 구독 단가 설정과 매출 기준 과금 단위 추정
- 설치형 PWA 기본 지원
- 통장/카드/홈택스/PG CSV 업로드
- 최근 CSV 업로드 이력 확인
- CSV 업로드 배치 되돌리기
- 원본 CSV DB 보관 및 업로드 이력 원본 다운로드
- CSV 컬럼 매핑
- CSV 매핑 템플릿 저장, 자동 적용 상태 확인, 템플릿 목록 다운로드와 개별 삭제
- CSV 파일 해시 기반 중복 업로드 방지
- 수기 거래 입력
- 거래 자동 분류 초안
- 사용자 자동 분류 규칙
- 거래처별 기본 계정 관리
- 계정과목 수동 확정
- 증빙 상태 관리
- 증빙-거래 추천 매칭
- 소형 증빙 파일 DB 보관 및 다운로드
- 증빙 개별 삭제와 민감 데이터 보관/삭제 기준 확인
- 검토함
- 검토 항목 처리 상태 관리
- 주요 작업과 접근 성공/실패/잠금/로그아웃 감사 로그
- 대시보드 최근 월 신고 준비율
- 월별 손익, 부가세 신고 입력 전 정리표, 위험거래 리포트
- 신고 차단/확인 항목을 순서대로 보여주는 최종 신고 점검
- 신고 일정과 신고 준비 순서 안내
- 부가세, 원천세, 법인세 입력 전 확인할 표를 연결해 주는 홈택스 제출 전 입력 가이드
- 홈택스 입력 전 부가세/원천세/법인세 신고서 입력값 요약
- 신고 전 통장/카드/홈택스/PG 자료 수집 현황 확인
- 승인 분개 기준 계정별 원장, 재무제표 초안, 현금흐름 요약과 통장 잔액 대조
- 신고 준비자료 브라우저 인쇄/PDF 저장, XLSX 통합 문서, JSON/CSV/DB 보관 증빙 ZIP 패키지 다운로드
- 월 마감 잠금/해제로 확정 기간의 거래, 증빙, 분개, 리포트 변경 차단
- 원본 CSV, 증빙 파일, 월 마감 상태, 데이터 보관/삭제 기준, 백업 점검표를 포함한 전체 워크스페이스 백업 JSON/ZIP 다운로드와 백업 JSON 복원

## 파일 및 요청 한도

현재 MVP는 Railway Postgres에 소형 원본과 증빙을 직접 보관하는 구조입니다.

- 원본 CSV 보관: 파일당 2MB 이하
- CSV 가져오기 요청: JSON body 5MB 이하
- DB 보관 증빙 파일: 파일당 750KB 이하
- 백업 JSON 복원 요청: JSON body 25MB 이하
- 일반 설정/장부 API 요청: JSON body 750KB 이하

위 한도는 `src/lib/file-limits.ts`와 `src/lib/server/request-json.ts`에 고정되어 있습니다. 더 큰 원본, 증빙, 백업을 다뤄야 하면 Postgres 직접 보관이 아니라 오브젝트 스토리지와 스트리밍 업로드를 별도 도입합니다.

원본 CSV와 증빙 파일 암호화 동작은 아래 명령으로 확인합니다.

```bash
npm run verify:file-encryption
```

## CSV 샘플 제공 방식

실제 은행/카드/홈택스에서 내려받은 CSV를 사용합니다. 계좌번호, 사업자번호, 거래처명, 카드번호는 마스킹해도 됩니다. 중요한 것은 실제 컬럼 구조를 유지하는 것입니다.

앱의 업로드 화면에서 자료 유형별 샘플 CSV를 내려받을 수 있습니다. 저장소 기준 샘플 파일은 `public/samples/`에 있습니다.

샘플 CSV가 현재 컬럼 자동 매핑과 정규화 로직을 통과하는지는 아래 명령으로 확인합니다.

```bash
npm run verify:samples
```

DB 연결 환경에서 핵심 저장 흐름을 검증하려면 앱 서버를 실행한 뒤 아래 명령을 사용합니다. 이 검증은 테스트용 거래, 승인 분개, 리포트 스냅샷, 월 마감 잠금을 만들고 정리하므로 로컬 또는 스테이징 DB에서 실행합니다.

```bash
VERIFY_DB_WORKFLOW_BASE_URL=http://127.0.0.1:3000 npm run verify:db-workflow
```

백업 복원 화면과 `dryRun` 검증은 프로덕션 빌드 후 아래 명령으로 확인합니다. 실제 복원은 실행하지 않고 백업 형식 검사와 `confirmReplace` 가드만 확인합니다.

```bash
npm run build
npm run verify:backup-restore
```

## 웹/앱 지원

혼자장부는 Next.js 웹앱으로 실행하며, `manifest.webmanifest`와 service worker를 통해 설치형 PWA 기본 동작을 지원합니다. 상단 바의 `앱 설치` 버튼은 브라우저가 제공하는 PWA 설치 프롬프트를 호출하고, 네트워크가 끊긴 상태에서 앱 화면 이동이 실패하면 `public/offline.html`을 표시합니다.

PWA 리소스와 service worker 등록 상태는 프로덕션 빌드 후 아래 명령으로 확인합니다.

```bash
npm run build
npm run verify:pwa
npm run verify:access-control
```

DB 연결 모드에서는 거래/증빙이 0건이어도 샘플 데이터로 대체하지 않습니다. CSV를 여러 번 가져오면 새 배치를 기존 화면 상태와 병합합니다.
