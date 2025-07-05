#!/usr/bin/env node

/**
 * 알라딘 도서 검색 MCP 서버 (Node.js)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES 모듈에서 __dirname 대체
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 카테고리 정보 로드
const categoryDataPath = path.join(__dirname, 'aladin_book_categories.json');
const categoryData = JSON.parse(fs.readFileSync(categoryDataPath, 'utf8'));

// 환경 변수 설정
const ALADIN_BASE_URL = 'https://www.aladin.co.kr/ttb/api';
const ALADIN_TTB_KEY = process.env.ALADIN_TTB_KEY?.trim();

// 로깅 설정 (stderr 사용하여 JSON-RPC 충돌 방지)
const logger = {
  error: (message: string) => console.error(`[ERROR] ${message}`)
};

// 카테고리 정보 인터페이스
interface CategoryInfo {
  cid: string;
  name: string;
  mall: string;
}

interface CategoryNode {
  name: string;
  level: number;
  children?: { [key: string]: CategoryNode };
  categories?: CategoryInfo[];
}

// 카테고리 검색 함수 (레벨 우선순위 적용)
function searchCategories(searchTerm: string, data: any): CategoryInfo[] {
  const results: Array<CategoryInfo & { level: number; fullPath: string }> = [];
  
  function traverse(node: CategoryNode, path: string[] = [], currentLevel: number = 1) {
    // 현재 노드의 카테고리 정보 확인
    if (node.categories) {
      for (const category of node.categories) {
        if (category.name.toLowerCase().includes(searchTerm.toLowerCase())) {
          results.push({
            ...category,
            level: currentLevel,
            fullPath: `${path.join(' > ')} > ${category.name}`,
            name: category.name // 원본 이름 유지
          });
        }
      }
    }
    
    // 자식 노드 순회
    if (node.children) {
      for (const [childName, childNode] of Object.entries(node.children)) {
        traverse(childNode, [...path, childName], currentLevel + 1);
      }
    }
  }
  
  for (const [rootName, rootNode] of Object.entries(data)) {
    traverse(rootNode as CategoryNode, [rootName]);
  }
  
  // 레벨별로 정렬 (level 1이 가장 우선, 같은 레벨에서는 이름순)
  results.sort((a, b) => {
    if (a.level !== b.level) {
      return a.level - b.level;
    }
    return a.name.localeCompare(b.name);
  });
  
  // 결과 반환 시 fullPath를 name으로 설정
  return results.map(result => ({
    cid: result.cid,
    name: result.fullPath,
    mall: result.mall
  }));
}

// 전체 카테고리 목록 추출 함수
function getAllCategories(data: any): CategoryInfo[] {
  const results: CategoryInfo[] = [];
  
  function traverse(node: CategoryNode, path: string[] = []) {
    if (node.categories) {
      for (const category of node.categories) {
        results.push({
          ...category,
          name: `${path.join(' > ')} > ${category.name}`
        });
      }
    }
    
    if (node.children) {
      for (const [childName, childNode] of Object.entries(node.children)) {
        traverse(childNode, [...path, childName]);
      }
    }
  }
  
  for (const [rootName, rootNode] of Object.entries(data)) {
    traverse(rootNode as CategoryNode, [rootName]);
  }
  
  return results;
}

// 도서 검색 결과 타입 정의
interface BookSearchResult {
  title: string;
  author: string;
  publisher: string;
  pubDate: string;
  isbn: string;
  isbn13: string;
  cover: string;
  categoryName: string;
  description: string;
  priceStandard: number;
  priceSales: number;
  link: string;
  pages?: number; // 페이지 수 추가
}

interface BookDetailResult extends BookSearchResult {
  fullDescription: string;
  customerReviewRank?: number;
}

// 도서 정보를 표 형태로 포맷하는 함수
function formatBooksTable(books: BookSearchResult[]): string {
  if (books.length === 0) {
    return '검색 결과가 없습니다.';
  }

  // 테이블 헤더
  let table = '| 제목 | 출판사 | 출간일 | 가격 | 페이지 |\n';
  table += '|------|--------|--------|------|------|\n';

  // 테이블 내용
  books.forEach(book => {
    // 제목이 너무 길면 줄임
    const title = book.title.length > 30 ? book.title.substring(0, 30) + '...' : book.title;
    const publisher = book.publisher || 'N/A';
    const pubDate = book.pubDate || 'N/A';
    // 정가 우선, 정가가 없으면 판매가 표시
    const price = book.priceStandard > 0 ? `${book.priceStandard.toLocaleString()}원` : 
                  book.priceSales > 0 ? `${book.priceSales.toLocaleString()}원` : 'N/A';
    const pages = book.pages ? `${book.pages}p` : 'N/A';
    
    table += `| ${title} | ${publisher} | ${pubDate} | ${price} | ${pages} |\n`;
  });

  return table;
}

// 알라딘 API 호출 함수
async function callAladinApi(endpoint: string, params: Record<string, any>): Promise<any> {
  if (!ALADIN_TTB_KEY || ALADIN_TTB_KEY.length === 0) {
    throw new Error('알라딘 API 키가 설정되지 않았습니다. ALADIN_TTB_KEY 환경변수를 올바르게 설정해주세요.');
  }

  const baseParams = {
    ttbkey: ALADIN_TTB_KEY,
    output: 'js',
    version: '20131101'
  };

  const finalParams = { ...baseParams, ...params };
  const url = `${ALADIN_BASE_URL}/${endpoint}`;

  try {
    const response = await axios.get(url, { params: finalParams });
    return response.data;
  } catch (error) {
    logger.error(`알라딘 API 호출 오류: ${error}`);
    throw error;
  }
}

// MCP 서버 생성
const server = new McpServer({
  name: '알라딘 도서 검색',
  version: '1.0.0'
});

// 도서 검색 도구 등록
server.registerTool(
  'search_books',
  {
    title: '도서 검색',
    description: '알라딘에서 도서를 검색합니다.',
    inputSchema: {
      query: z.string().describe('검색어'),
      searchType: z.enum(['Title', 'Author', 'Publisher', 'Keyword']).default('Title').describe('검색 타입'),
      maxResults: z.number().min(1).max(100).default(10).describe('최대 결과 개수'),
      start: z.number().min(1).default(1).describe('검색 시작 번호')
    }
  },
  async ({ query, searchType, maxResults, start }) => {
    try {
      if (!query) {
        throw new Error('검색어를 입력해주세요.');
      }

      const params = {
        Query: query,
        QueryType: searchType,
        MaxResults: maxResults,
        start: start,
        SearchTarget: 'Book',
        Cover: 'Big'
      };

      const result = await callAladinApi('ItemSearch.aspx', params);
      
      const books: BookSearchResult[] = result.item?.map((item: any) => ({
        title: item.title || '',
        author: item.author || '',
        publisher: item.publisher || '',
        pubDate: item.pubDate || '',
        isbn: item.isbn || '',
        isbn13: item.isbn13 || '',
        cover: item.cover || '',
        categoryName: item.categoryName || '',
        description: item.description || '',
        priceStandard: item.priceStandard || 0,
        priceSales: item.priceSales || 0,
        link: item.link || '',
        pages: item.subInfo?.itemPage || undefined
      })) || [];

      return {
        content: [{
          type: 'text',
          text: `검색 결과: ${books.length}권의 도서를 찾았습니다.\n\n${books.map((book, index) => 
            `${index + 1}. ${book.title}\n` +
            `   저자: ${book.author}\n` +
            `   출판사: ${book.publisher}\n` +
            `   출간일: ${book.pubDate}\n` +
            `   가격: ${book.priceStandard > 0 ? book.priceStandard.toLocaleString() : book.priceSales.toLocaleString()}원\n` +
            `   ISBN: ${book.isbn13}\n` +
            `   카테고리: ${book.categoryName}\n` +
            `   설명: ${book.description}\n`
          ).join('\n')}`
        }]
      };
    } catch (error) {
      logger.error(`도서 검색 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `도서 검색 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 도서 상세 정보 도구 등록
server.registerTool(
  'get_book_detail',
  {
    title: '도서 상세 정보',
    description: 'ISBN을 이용해 도서의 상세 정보를 조회합니다.',
    inputSchema: {
      isbn: z.string().describe('도서의 ISBN (10자리 또는 13자리)')
    }
  },
  async ({ isbn }) => {
    try {
      if (!isbn) {
        throw new Error('ISBN을 입력해주세요.');
      }

      const params = {
        ItemId: isbn,
        ItemIdType: 'ISBN',
        Cover: 'Big',
        OptResult: 'description,fulldescription,ratingInfo,subInfo'
      };

      const result = await callAladinApi('ItemLookUp.aspx', params);
      
      const items = result.item || [];
      if (items.length === 0) {
        throw new Error('해당 ISBN의 도서를 찾을 수 없습니다.');
      }

      const item = items[0];
      const bookDetail: BookDetailResult = {
        title: item.title || '',
        author: item.author || '',
        publisher: item.publisher || '',
        pubDate: item.pubDate || '',
        isbn: item.isbn || '',
        isbn13: item.isbn13 || '',
        cover: item.cover || '',
        categoryName: item.categoryName || '',
        description: item.description || '',
        fullDescription: item.fullDescription || '',
        priceStandard: item.priceStandard || 0,
        priceSales: item.priceSales || 0,
        link: item.link || '',
        customerReviewRank: item.customerReviewRank,
        pages: item.subInfo?.itemPage || undefined
      };

      return {
        content: [{
          type: 'text',
          text: `도서 상세 정보:\n\n` +
            `제목: ${bookDetail.title}\n` +
            `저자: ${bookDetail.author}\n` +
            `출판사: ${bookDetail.publisher}\n` +
            `출간일: ${bookDetail.pubDate}\n` +
            `ISBN: ${bookDetail.isbn13}\n` +
            `카테고리: ${bookDetail.categoryName}\n` +
            `가격: ${bookDetail.priceStandard > 0 ? bookDetail.priceStandard.toLocaleString() : bookDetail.priceSales.toLocaleString()}원\n` +
            `고객평점: ${bookDetail.customerReviewRank || 'N/A'}\n\n` +
            `설명: ${bookDetail.description}\n\n` +
            `상세 설명: ${bookDetail.fullDescription}\n\n` +
            `링크: ${bookDetail.link}`
        }]
      };
    } catch (error) {
      logger.error(`도서 상세 정보 조회 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `도서 상세 정보 조회 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 베스트셀러 도구 등록
server.registerTool(
  'get_bestsellers',
  {
    title: '도서 베스트셀러',
    description: '알라딘 도서 베스트셀러 목록을 조회합니다. 카테고리별로 검색할 수 있습니다.',
    inputSchema: {
      queryType: z.enum(['Bestseller', 'ItemNewAll', 'ItemNewSpecial', 'ItemEditorChoice', 'BlogBest']).default('Bestseller').describe('조회 타입'),
      maxResults: z.number().min(1).max(100).default(10).describe('최대 결과 개수'),
      start: z.number().min(1).default(1).describe('검색 시작 번호'),
      categoryId: z.string().optional().describe('카테고리 ID (CID) - 특정 카테고리로 검색을 제한할 때 사용')
    }
  },
  async ({ queryType, maxResults, start, categoryId }) => {
    try {
      const params: any = {
        QueryType: queryType,
        MaxResults: maxResults,
        start: start,
        SearchTarget: 'Book', // 도서만 검색
        Cover: 'Big'
      };

      // 카테고리 ID가 제공된 경우 추가
      if (categoryId) {
        params.CategoryId = categoryId;
      }

      const result = await callAladinApi('ItemList.aspx', params);
      
      const books: BookSearchResult[] = result.item?.map((item: any) => ({
        title: item.title || '',
        author: item.author || '',
        publisher: item.publisher || '',
        pubDate: item.pubDate || '',
        isbn: item.isbn || '',
        isbn13: item.isbn13 || '',
        cover: item.cover || '',
        categoryName: item.categoryName || '',
        description: item.description || '',
        priceStandard: item.priceStandard || 0,
        priceSales: item.priceSales || 0,
        link: item.link || '',
        pages: item.subInfo?.itemPage || undefined
      })) || [];

      const categoryText = categoryId ? ` (카테고리: ${categoryId})` : '';
      
      return {
        content: [{
          type: 'text',
          text: `베스트셀러 목록 (${queryType})${categoryText}:\n\n${books.map((book, index) => 
            `${index + 1}. ${book.title}\n` +
            `   저자: ${book.author}\n` +
            `   출판사: ${book.publisher}\n` +
            `   출간일: ${book.pubDate}\n` +
            `   정가: ${book.priceStandard.toLocaleString()}원\n` +
            `   ISBN: ${book.isbn13}\n` +
            `   카테고리: ${book.categoryName}\n` +
            `   설명: ${book.description}\n`
          ).join('\n')}`
        }]
      };
    } catch (error) {
      logger.error(`베스트셀러 조회 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `베스트셀러 조회 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 카테고리 검색 도구 등록
server.registerTool(
  'search_categories',
  {
    title: '카테고리 검색',
    description: '알라딘 도서 카테고리를 검색합니다. 상위 레벨 카테고리를 우선으로 표시합니다.',
    inputSchema: {
      searchTerm: z.string().describe('검색할 카테고리 이름'),
      maxResults: z.number().min(1).max(50).default(20).describe('최대 결과 개수')
    }
  },
  async ({ searchTerm, maxResults }) => {
    try {
      const allCategories = searchCategories(searchTerm, categoryData);
      const categories = allCategories.slice(0, maxResults);
      
      if (categories.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `'${searchTerm}'과 관련된 카테고리를 찾을 수 없습니다.`
          }]
        };
      }
      
      // 레벨별로 그룹화
      const levelGroups: { [level: string]: any[] } = {};
      categories.forEach(cat => {
        const level = cat.name.split(' > ').length - 1;
        if (!levelGroups[level]) {
          levelGroups[level] = [];
        }
        levelGroups[level].push(cat);
      });
      
      let resultText = `'${searchTerm}' 검색 결과 (${categories.length}개${allCategories.length > maxResults ? `, 총 ${allCategories.length}개 중 상위 ${maxResults}개 표시` : ''}):\n\n`;
      
      // 레벨별로 표시
      Object.keys(levelGroups).sort((a, b) => Number(a) - Number(b)).forEach(level => {
        const levelName = level === '1' ? '대분류' : level === '2' ? '중분류' : '소분류';
        resultText += `📚 ${levelName} (Level ${level}):\n`;
        levelGroups[level].forEach((cat, index) => {
          resultText += `${index + 1}. ${cat.name}\n`;
          resultText += `   CID: ${cat.cid} | 몰: ${cat.mall}\n`;
        });
        resultText += '\n';
      });
      
      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };
    } catch (error) {
      logger.error(`카테고리 검색 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `카테고리 검색 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 인기 카테고리 목록 도구 등록
server.registerTool(
  'get_popular_categories',
  {
    title: '인기 카테고리',
    description: '자주 사용되는 주요 카테고리 목록을 조회합니다. 상위 레벨 카테고리를 우선으로 표시합니다.',
    inputSchema: {
      limit: z.number().min(1).max(50).default(20).describe('표시할 카테고리 개수')
    }
  },
  async ({ limit }) => {
    try {
      // 주요 카테고리들을 수동으로 선별
      const popularCategories = [
        { name: '소설', searchTerm: '소설' },
        { name: '에세이', searchTerm: '에세이' },
        { name: '자기계발', searchTerm: '자기계발' },
        { name: '경제경영', searchTerm: '경제경영' },
        { name: '시/에세이', searchTerm: '시' },
        { name: '인문학', searchTerm: '인문학' },
        { name: '역사', searchTerm: '역사' },
        { name: '철학', searchTerm: '철학' },
        { name: '과학', searchTerm: '과학' },
        { name: '건강', searchTerm: '건강' },
        { name: '요리', searchTerm: '요리' },
        { name: '육아', searchTerm: '육아' },
        { name: '교육', searchTerm: '교육' },
        { name: '컴퓨터', searchTerm: '컴퓨터' },
        { name: '외국어', searchTerm: '외국어' },
        { name: '여행', searchTerm: '여행' },
        { name: '예술', searchTerm: '예술' },
        { name: '종교', searchTerm: '종교' },
        { name: '만화', searchTerm: '만화' },
        { name: '아동', searchTerm: '아동' }
      ];
      
      const results: any[] = [];
      
      for (const popular of popularCategories.slice(0, limit)) {
        const categories = searchCategories(popular.searchTerm, categoryData);
        if (categories.length > 0) {
          // 상위 레벨 카테고리 우선 선택 (대분류 > 중분류 > 소분류)
          const topCategories = categories.slice(0, 3);
          
          results.push({
            name: popular.name,
            categories: topCategories
          });
        }
      }
      
      let resultText = `인기 카테고리 목록 (상위 레벨 우선):\n\n`;
      
      results.forEach((result, index) => {
        resultText += `🔥 ${index + 1}. ${result.name}\n`;
        result.categories.forEach((cat: any, catIndex: number) => {
          const level = cat.name.split(' > ').length - 1;
          const levelIcon = level === 1 ? '📚' : level === 2 ? '📖' : '📄';
          const categoryName = cat.name.split(' > ').pop();
          resultText += `   ${levelIcon} ${categoryName} (CID: ${cat.cid})\n`;
        });
        resultText += '\n';
      });
      
      return {
        content: [{
          type: 'text',
          text: resultText
        }]
      };
    } catch (error) {
      logger.error(`인기 카테고리 조회 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `인기 카테고리 조회 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 도서 정보 표 형태 표시 도구 등록
server.registerTool(
  'format_books_table',
  {
    title: '도서 정보 표 형태 표시',
    description: '도서 정보를 표 형태로 정리하여 표시합니다. 검색, ISBN 조회, 베스트셀러 조회를 지원합니다.',
    inputSchema: {
      type: z.enum(['search', 'isbn', 'bestseller']).describe('조회 타입: search(검색), isbn(ISBN 조회), bestseller(베스트셀러)'),
      query: z.string().optional().describe('검색어 (type이 search인 경우 필수)'),
      isbn: z.string().optional().describe('ISBN (type이 isbn인 경우 필수)'),
      searchType: z.enum(['Title', 'Author', 'Publisher', 'Keyword']).default('Title').describe('검색 타입 (type이 search인 경우)'),
      queryType: z.enum(['Bestseller', 'ItemNewAll', 'ItemNewSpecial', 'ItemEditorChoice', 'BlogBest']).default('Bestseller').describe('베스트셀러 조회 타입 (type이 bestseller인 경우)'),
      maxResults: z.number().min(1).max(50).default(10).describe('최대 결과 개수'),
      categoryId: z.string().optional().describe('카테고리 ID (베스트셀러 조회 시 카테고리 제한)')
    }
  },
  async ({ type, query, isbn, searchType, queryType, maxResults, categoryId }) => {
    try {
      let books: BookSearchResult[] = [];

      if (type === 'search') {
        if (!query) {
          throw new Error('검색어를 입력해주세요.');
        }

        const params = {
          Query: query,
          QueryType: searchType,
          MaxResults: maxResults,
          start: 1,
          SearchTarget: 'Book',
          Cover: 'Big'
        };

        const result = await callAladinApi('ItemSearch.aspx', params);
        books = result.item?.map((item: any) => ({
          title: item.title || '',
          author: item.author || '',
          publisher: item.publisher || '',
          pubDate: item.pubDate || '',
          isbn: item.isbn || '',
          isbn13: item.isbn13 || '',
          cover: item.cover || '',
          categoryName: item.categoryName || '',
          description: item.description || '',
          priceStandard: item.priceStandard || 0,
          priceSales: item.priceSales || 0,
          link: item.link || '',
          pages: item.subInfo?.itemPage || undefined
        })) || [];

      } else if (type === 'isbn') {
        if (!isbn) {
          throw new Error('ISBN을 입력해주세요.');
        }

        const params = {
          ItemId: isbn,
          ItemIdType: 'ISBN',
          Cover: 'Big',
          OptResult: 'description,fulldescription,ratingInfo,subInfo'
        };

        const result = await callAladinApi('ItemLookUp.aspx', params);
        const items = result.item || [];
        
        if (items.length === 0) {
          throw new Error('해당 ISBN의 도서를 찾을 수 없습니다.');
        }

        const item = items[0];
        books = [{
          title: item.title || '',
          author: item.author || '',
          publisher: item.publisher || '',
          pubDate: item.pubDate || '',
          isbn: item.isbn || '',
          isbn13: item.isbn13 || '',
          cover: item.cover || '',
          categoryName: item.categoryName || '',
          description: item.description || '',
          priceStandard: item.priceStandard || 0,
          priceSales: item.priceSales || 0,
          link: item.link || '',
          pages: item.subInfo?.itemPage || undefined
        }];

      } else if (type === 'bestseller') {
        const params: any = {
          QueryType: queryType,
          MaxResults: maxResults,
          start: 1,
          SearchTarget: 'Book',
          Cover: 'Big'
        };

        if (categoryId) {
          params.CategoryId = categoryId;
        }

        const result = await callAladinApi('ItemList.aspx', params);
        books = result.item?.map((item: any) => ({
          title: item.title || '',
          author: item.author || '',
          publisher: item.publisher || '',
          pubDate: item.pubDate || '',
          isbn: item.isbn || '',
          isbn13: item.isbn13 || '',
          cover: item.cover || '',
          categoryName: item.categoryName || '',
          description: item.description || '',
          priceStandard: item.priceStandard || 0,
          priceSales: item.priceSales || 0,
          link: item.link || '',
          pages: item.subInfo?.itemPage || undefined
        })) || [];
      }

      // 표 형태로 포맷
      const table = formatBooksTable(books);
      
      let title = '';
      if (type === 'search') {
        title = `📚 도서 검색 결과 (${query})`;
      } else if (type === 'isbn') {
        title = `📚 도서 상세 정보 (ISBN: ${isbn})`;
      } else if (type === 'bestseller') {
        const categoryText = categoryId ? ` (카테고리: ${categoryId})` : '';
        title = `📚 베스트셀러 목록 (${queryType})${categoryText}`;
      }

      return {
        content: [{
          type: 'text',
          text: `${title}\n\n${table}`
        }]
      };
    } catch (error) {
      logger.error(`도서 정보 표 형태 표시 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `도서 정보 표 형태 표시 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 서버 시작
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // 시작 로그 제거 (JSON-RPC 충돌 방지)
  } catch (error) {
    logger.error(`서버 시작 중 오류 발생: ${error}`);
    process.exit(1);
  }
}

// 메인 함수 실행
main().catch(error => {
  logger.error(`메인 함수 실행 중 오류 발생: ${error}`);
  process.exit(1);
}); 