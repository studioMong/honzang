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
```

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
- 주요 작업 활동 로그
- 대시보드 최근 월 신고 준비율
- 월별 손익, 부가세 신고 입력 전 정리표, 위험거래 리포트
- 신고 차단/확인 항목을 순서대로 보여주는 최종 신고 점검
- 신고 일정과 신고 준비 순서 안내
- 부가세, 원천세, 법인세 입력 전 확인할 표를 연결해 주는 홈택스 제출 전 입력 가이드
- 신고 전 통장/카드/홈택스/PG 자료 수집 현황 확인
- 승인 분개 기준 계정별 원장과 재무제표 초안
- 신고 준비자료 브라우저 인쇄/PDF 저장, XLSX 통합 문서, JSON/CSV/DB 보관 증빙 ZIP 패키지 다운로드
- 월 마감 잠금/해제로 확정 기간의 거래, 증빙, 분개, 리포트 변경 차단
- 원본 CSV, 증빙 파일, 월 마감 상태, 데이터 보관/삭제 기준, 백업 점검표를 포함한 전체 워크스페이스 백업 JSON/ZIP 다운로드와 백업 JSON 복원

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
```

DB 연결 모드에서는 거래/증빙이 0건이어도 샘플 데이터로 대체하지 않습니다. CSV를 여러 번 가져오면 새 배치를 기존 화면 상태와 병합합니다.
