# Railway 배포 전환 체크리스트

이 문서는 `https://honzang-production.up.railway.app` 공개 도메인이 최신 Next.js standalone 서비스와 Railway Postgres를 바라보게 전환하는 절차를 고정한다.

## 목표 상태
- 공개 도메인: `https://honzang-production.up.railway.app`
- 앱 서비스 빌더: Dockerfile
- Healthcheck Path: `/api/health`
- Start Command: `npm run start`
- Pre-deploy Command: `npm run db:deploy`
- Postgres: 앱 서비스 Variables의 `DATABASE_URL`이 Railway Postgres 참조 변수로 연결됨
- 접근 보호: `HONZANG_ACCESS_CODE`와 `HONZANG_ACCESS_TOKEN_SALT` 설정
- 파일 보호: `HONZANG_FILE_ENCRYPTION_KEY` 설정

## Railway Dashboard 점검 순서
1. GitHub 저장소 `studioMong/honzang`가 앱 서비스에 연결되어 있는지 확인한다.
2. 앱 서비스 Settings에서 Builder가 Dockerfile인지 확인한다.
3. 앱 서비스 Deploy 설정을 확인한다.
   - Pre-deploy Command: `npm run db:deploy`
   - Start Command: `npm run start`
   - Healthcheck Path: `/api/health`
4. 앱 서비스 Variables를 확인한다.
   - `DATABASE_URL`: Postgres 서비스 참조 변수
   - `NEXT_PUBLIC_APP_URL`: `https://honzang-production.up.railway.app`
   - `HONZANG_ACCESS_CODE`: 운영 접근 코드
   - `HONZANG_ACCESS_TOKEN_SALT`: 긴 랜덤 문자열
   - `HONZANG_FILE_ENCRYPTION_KEY`: 원본 CSV와 DB 보관 증빙 파일 암호화용 긴 랜덤 문자열
5. Public Networking 또는 Domains에서 `honzang-production.up.railway.app`가 최신 Next.js 앱 서비스에 붙어 있는지 확인한다.
6. 같은 도메인이 이전 static/legacy 서비스에 남아 있으면 해당 연결을 제거하거나 도메인을 최신 앱 서비스로 이동한다.
7. 최신 `main` 커밋으로 앱 서비스를 재배포한다.

## 로컬에서 먼저 확인
```bash
npm run verify:mvp
```

DB 연결 staging 환경이 있으면 아래 검증도 실행한다.

```bash
VERIFY_DB_WORKFLOW_BASE_URL=https://staging-url.example.com npm run verify:db-workflow
```

접근코드 보호가 켜진 staging 환경에서는 아래처럼 검증용 접근코드를 함께 전달한다.

```bash
VERIFY_DB_WORKFLOW_ACCESS_CODE=접근코드 VERIFY_DB_WORKFLOW_BASE_URL=https://staging-url.example.com npm run verify:db-workflow
```

운영 공개 URL에는 기본적으로 mutation workflow를 실행하지 않는다. 불가피하게 운영에서 실행해야 할 때만 아래처럼 명시적으로 허용한다.

```bash
VERIFY_DB_WORKFLOW_ALLOW_PRODUCTION=1 VERIFY_DB_WORKFLOW_ACCESS_CODE=접근코드 VERIFY_DB_WORKFLOW_BASE_URL=https://honzang-production.up.railway.app npm run verify:db-workflow
```

## 공개 URL 감사
최신 커밋이 공개 URL에 반영됐는지 확인한다.

```bash
RAILWAY_EXPECTED_COMMIT=$(git rev-parse HEAD) npm run verify:railway
npm run verify:railway-access
```

실패 원인을 분류하려면 감사 스크립트를 사용한다.

```bash
RAILWAY_EXPECTED_COMMIT=$(git rev-parse HEAD) npm run audit:railway
```

아직 전환 전이라 실패를 기록만 해야 할 때는 soft mode를 사용한다.

```bash
RAILWAY_AUDIT_SOFT=1 RAILWAY_EXPECTED_COMMIT=$(git rev-parse HEAD) npm run audit:railway
```

## 현재 반복 실패 패턴
아래 결과가 나오면 공개 도메인이 최신 Next.js 앱 서비스가 아니라 기존 static/legacy 서비스에 연결된 상태로 판단한다.

- `/`: HTTP 200이지만 이전 프로젝트 요약 HTML이 응답됨
- `/api/version`: HTTP 404
- `/api/health`: HTTP 404
- `/manifest.webmanifest`: HTTP 404

이 경우 코드 수정이 아니라 Railway Dashboard에서 public domain 연결 대상 서비스를 바꾸는 작업이 필요하다.
