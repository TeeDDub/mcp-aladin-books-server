# 알라딘 도서 검색 MCP 서버 (Node.js)

알라딘 도서 검색 API를 활용한 MCP(Model Context Protocol) 서버입니다.

<a href="https://glama.ai/mcp/servers/@TeeDDub/mcp-aladin-books-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@TeeDDub/mcp-aladin-books-server/badge" alt="Aladin Book Search Server MCP server" />
</a>

## 특징

- **도서 검색**: 제목, 저자, 출판사, 키워드로 도서 검색
- **상세 정보**: ISBN으로 도서 상세 정보 조회
- **베스트셀러**: 알라딘 베스트셀러 목록 조회 (카테고리별 검색 지원)
- **카테고리 검색**: 도서 카테고리 검색 및 조회 (상위 레벨 우선 표시)


## 알라딘 API 키 발급
이 MCP 서버를 사용하려면 알라딘의 API 키가 필요합니다.

1. [알라딘 TTB 사이트](https://www.aladin.co.kr/ttb/wblog_manage.aspx)에 접속
2. 회원가입 및 로그인
3. API 키 발급 신청

## DXT 설치
[DXT 파일](mcp-aladin.dxt)

1. 클로드 데스크톱에서 \[설정\] - \[확장프로그램\]을 선택
2. 다운 받은 DXT 파일을 드래그 앤 드롭
3. API 키를 입력 

## 설정

### 1. 의존성 설치 및 빌드

```bash
npm install
npm run build
```

### 2. MCP 클라이언트에 정보 입력
```
{
  "mcpServers": {
    "aladin-books": {
      "command": "node",
      "args": [
        "<경로>/mcp-aladin-books-server/dist/index.js"
      ],
      "env": {
        "ALADIN_TTB_KEY": "알라딘_TTB_키"
      }
    }
  }
}
```



## 도구 (Tools)

### 1. search_books
도서를 검색합니다.

**매개변수:**
- `query` (string): 검색어
- `searchType` (enum): 검색 타입 (Title, Author, Publisher, Keyword)
- `maxResults` (number): 최대 결과 개수 (1-100, 기본값: 10)
- `start` (number): 검색 시작 번호 (기본값: 1)

### 2. get_book_detail
ISBN으로 도서 상세 정보를 조회합니다.

**매개변수:**
- `isbn` (string): 도서의 ISBN (10자리 또는 13자리)

### 3. get_bestsellers
도서 베스트셀러 목록을 조회합니다. 카테고리별 검색이 가능합니다.

**매개변수:**
- `maxResults` (number): 최대 결과 개수 (1-100, 기본값: 10)
- `start` (number): 검색 시작 번호 (기본값: 1)
- `categoryId` (string, optional): 카테고리 ID (CID) - 특정 카테고리로 검색 제한

### 4. get_new_books
신간 전체 리스트를 조회합니다. 카테고리별 검색이 가능합니다.

**매개변수:**
- `maxResults` (number): 최대 결과 개수 (1-100, 기본값: 10)
- `start` (number): 검색 시작 번호 (기본값: 1)
- `categoryId` (string, optional): 카테고리 ID (CID) - 특정 카테고리로 검색 제한

### 5. get_special_new_books
주목할 만한 신간 리스트를 조회합니다. 카테고리별 검색이 가능합니다.

**매개변수:**
- `maxResults` (number): 최대 결과 개수 (1-100, 기본값: 10)
- `start` (number): 검색 시작 번호 (기본값: 1)
- `categoryId` (string, optional): 카테고리 ID (CID) - 특정 카테고리로 검색 제한

### 6. get_editor_choice
편집자 추천 리스트를 조회합니다. 카테고리별 검색이 가능합니다.

**매개변수:**
- `maxResults` (number): 최대 결과 개수 (1-100, 기본값: 10)
- `start` (number): 검색 시작 번호 (기본값: 1)
- `categoryId` (string, optional): 카테고리 ID (CID) - 특정 카테고리로 검색 제한

### 7. get_blogger_best
블로거 베스트셀러 목록을 조회합니다. 국내도서만 조회 가능하며, 카테고리별 검색이 가능합니다.

**매개변수:**
- `maxResults` (number): 최대 결과 개수 (1-100, 기본값: 10)
- `start` (number): 검색 시작 번호 (기본값: 1)
- `categoryId` (string, optional): 카테고리 ID (CID) - 특정 카테고리로 검색 제한

### 8. search_categories
도서 카테고리를 검색합니다. 상위 레벨 카테고리를 우선으로 표시합니다.

**매개변수:**
- `searchTerm` (string): 검색할 카테고리 이름
- `maxResults` (number): 최대 결과 개수 (1-50, 기본값: 20)

### 9. get_popular_categories
자주 사용되는 주요 카테고리 목록을 조회합니다. 상위 레벨 카테고리를 우선으로 표시합니다.

**매개변수:**
- `limit` (number): 표시할 카테고리 개수 (1-50, 기본값: 20)

### 10. format_books_table
도서 정보를 표 형태로 정리하여 표시합니다. 검색, ISBN 조회, 각종 도서 리스트 조회를 지원합니다.

**매개변수:**
- `type` (enum): 조회 타입 (search, isbn, bestseller, new_books, special_new_books, editor_choice, blogger_best)
- `query` (string, optional): 검색어 (type이 search인 경우 필수)
- `isbn` (string, optional): ISBN (type이 isbn인 경우 필수)
- `searchType` (enum): 검색 타입 (Title, Author, Publisher, Keyword, 기본값: Title)
- `maxResults` (number): 최대 결과 개수 (1-50, 기본값: 10)
- `categoryId` (string, optional): 카테고리 ID (리스트 조회 시 카테고리 제한)


## 사용 예시

MCP 클라이언트에서 다음과 같이 사용할 수 있습니다:

```javascript
// 도서 검색
await callTool('search_books', {
  query: '파이썬',
  searchType: 'Title',
  maxResults: 5
});

// 도서 상세 정보
await callTool('get_book_detail', {
  isbn: '9788966262755'
});

// 전체 도서 베스트셀러 조회
await callTool('get_bestsellers', {
  maxResults: 10
});

// 카테고리별 도서 베스트셀러 조회
await callTool('get_bestsellers', {
  maxResults: 10,
  categoryId: '798' // 예: 컴퓨터 카테고리
});

// 신간 전체 리스트 조회
await callTool('get_new_books', {
  maxResults: 10
});

// 카테고리별 신간 조회
await callTool('get_new_books', {
  maxResults: 10,
  categoryId: '798' // 예: 컴퓨터 카테고리
});

// 주목할 만한 신간 리스트 조회
await callTool('get_special_new_books', {
  maxResults: 10
});

// 편집자 추천 리스트 조회
await callTool('get_editor_choice', {
  maxResults: 10
});

// 블로거 베스트셀러 조회 (국내도서만)
await callTool('get_blogger_best', {
  maxResults: 10,
  categoryId: '798' // 예: 컴퓨터 카테고리
});

// 카테고리 검색 (상위 레벨 우선)
await callTool('search_categories', {
  searchTerm: '소설',
  maxResults: 10
});

// 인기 카테고리 조회 (상위 레벨 우선)
await callTool('get_popular_categories', {
  limit: 10
});

// 도서 정보 표 형태 표시 (검색)
await callTool('format_books_table', {
  type: 'search',
  query: '파이썬',
  searchType: 'Title',
  maxResults: 5
});

// 도서 정보 표 형태 표시 (베스트셀러)
await callTool('format_books_table', {
  type: 'bestseller',
  maxResults: 10,
  categoryId: '798'
});

// 도서 정보 표 형태 표시 (신간 전체)
await callTool('format_books_table', {
  type: 'new_books',
  maxResults: 10
});

// 도서 정보 표 형태 표시 (주목할 만한 신간)
await callTool('format_books_table', {
  type: 'special_new_books',
  maxResults: 10
});

// 도서 정보 표 형태 표시 (편집자 추천)
await callTool('format_books_table', {
  type: 'editor_choice',
  maxResults: 10
});

// 도서 정보 표 형태 표시 (블로거 베스트셀러)
await callTool('format_books_table', {
  type: 'blogger_best',
  maxResults: 10,
  categoryId: '798'
});
```

## 개발

### 프로젝트 구조

```
server/
├── src/
│   ├── index.ts                     # 메인 서버 파일
│   └── aladin_book_categories.json  # 카테고리 정보 파일 (대용량)
├── dist/                            # 빌드 결과물
├── package.json                     # 패키지 설정
├── tsconfig.json                    # TypeScript 설정
├── env.example                      # 환경 변수 예시
├── test.js                          # 테스트 파일
└── README.md                        # 문서
```

### 기술 스택

- **Node.js**: 런타임 환경
- **TypeScript**: 타입 안전성 (ES2020 타겟, ESNext 모듈)
- **@modelcontextprotocol/sdk**: MCP 프로토콜 구현
- **axios**: HTTP 클라이언트
- **zod**: 스키마 검증

### 개발 의존성

- **tsx**: TypeScript 개발 실행기
- **@types/node**: Node.js 타입 정의

### 빌드 설정

- **타겟**: ES2020
- **모듈**: ESNext
- **출력 디렉터리**: dist/
- **소스맵**: 포함
- **선언 파일**: 생성
- **JSON 모듈**: 지원

## 환경 변수

```env
# 알라딘 TTB 키 (필수)
ALADIN_TTB_KEY=your_aladin_ttb_key_here
```

## 라이선스

ISC