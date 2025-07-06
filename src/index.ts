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
  pricePerPage?: number; // 쪽단가 추가
}

interface BookDetailResult extends BookSearchResult {
  fullDescription: string;
  customerReviewRank?: number;
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
        pages: item.subInfo?.itemPage || undefined,
        pricePerPage: (item.priceStandard > 0 && item.subInfo?.itemPage > 0) 
          ? parseFloat((item.priceStandard / item.subInfo.itemPage).toFixed(2)) 
          : undefined
      })) || [];

      return {
        content: [{
          type: 'text',
          text: `📚 도서 검색 결과 (${query})\n\n검색된 도서 수: ${books.length}권\n\n${JSON.stringify(books, null, 2)}`
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
        pages: item.subInfo?.itemPage || undefined,
        pricePerPage: (item.priceStandard > 0 && item.subInfo?.itemPage > 0) 
          ? parseFloat((item.priceStandard / item.subInfo.itemPage).toFixed(2)) 
          : undefined
      };

      return {
        content: [{
          type: 'text',
          text: `📚 도서 상세 정보 (ISBN: ${isbn})\n\n${JSON.stringify(bookDetail, null, 2)}`
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
    description: '알라딘 도서 베스트셀러 목록을 조회합니다. 카테고리별로 검색할 수 있으며, 특정 주간의 베스트셀러를 조회할 수 있습니다. 특정 주간을 조회할 때는 연도, 월, 주를 모두 입력해주세요.',
    inputSchema: {
      maxResults: z.number().min(1).max(100).default(10).describe('최대 결과 개수'),
      start: z.number().min(1).default(1).describe('검색 시작 번호'),
      categoryId: z.string().optional().describe('카테고리 ID (CID) - 특정 카테고리로 검색을 제한할 때 사용'),
      year: z.number().min(2000).max(2030).optional().describe('조회할 연도 (예: 2025) - 생략하면 현재 주간'),
      month: z.number().min(1).max(12).optional().describe('조회할 월 (1-12) - 생략하면 현재 주간'),
      week: z.number().min(1).max(5).optional().describe('조회할 주 (1-5) - 생략하면 현재 주간')
    }
  },
  async ({ maxResults, start, categoryId, year, month, week }) => {
    try {
      const params: any = {
        QueryType: 'Bestseller',
        MaxResults: maxResults,
        start: start,
        SearchTarget: 'Book',
        Cover: 'Big'
      };

      if (categoryId) {
        params.CategoryId = categoryId;
      }

      if (year) {
        params.Year = year;
      }
      
      if (month) {
        params.Month = month;
      }
      
      if (week) {
        params.Week = week;
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
        pages: item.subInfo?.itemPage || undefined,
        pricePerPage: (item.priceStandard > 0 && item.subInfo?.itemPage > 0) 
          ? parseFloat((item.priceStandard / item.subInfo.itemPage).toFixed(2)) 
          : undefined
      })) || [];

      const categoryText = categoryId ? ` (카테고리: ${categoryId})` : '';
      const timeText = (year && month && week) ? ` (${year}년 ${month}월 ${week}주)` : '';
      
      return {
        content: [{
          type: 'text',
          text: `📈 베스트셀러 목록${categoryText}${timeText}\n\n검색된 도서 수: ${books.length}권\n\n${JSON.stringify(books, null, 2)}`
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

// 신간 전체 리스트 도구 등록
server.registerTool(
  'get_new_books',
  {
    title: '신간 전체 리스트',
    description: '알라딘 신간 전체 리스트를 조회합니다. 카테고리별로 검색할 수 있습니다.',
    inputSchema: {
      maxResults: z.number().min(1).max(100).default(10).describe('최대 결과 개수'),
      start: z.number().min(1).default(1).describe('검색 시작 번호'),
      categoryId: z.string().optional().describe('카테고리 ID (CID) - 특정 카테고리로 검색을 제한할 때 사용')
    }
  },
  async ({ maxResults, start, categoryId }) => {
    try {
      const params: any = {
        QueryType: 'ItemNewAll',
        MaxResults: maxResults,
        start: start,
        SearchTarget: 'Book',
        Cover: 'Big'
      };

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
        pages: item.subInfo?.itemPage || undefined,
        pricePerPage: (item.priceStandard > 0 && item.subInfo?.itemPage > 0) 
          ? parseFloat((item.priceStandard / item.subInfo.itemPage).toFixed(2)) 
          : undefined
      })) || [];

      const categoryText = categoryId ? ` (카테고리: ${categoryId})` : '';
      
      return {
        content: [{
          type: 'text',
          text: `🆕 신간 전체 리스트${categoryText}\n\n검색된 도서 수: ${books.length}권\n\n${JSON.stringify(books, null, 2)}`
        }]
      };
    } catch (error) {
      logger.error(`신간 전체 리스트 조회 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `신간 전체 리스트 조회 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 주목할 만한 신간 리스트 도구 등록
server.registerTool(
  'get_special_new_books',
  {
    title: '주목할 만한 신간 리스트',
    description: '알라딘 주목할 만한 신간 리스트를 조회합니다. 카테고리별로 검색할 수 있습니다.',
    inputSchema: {
      maxResults: z.number().min(1).max(100).default(10).describe('최대 결과 개수'),
      start: z.number().min(1).default(1).describe('검색 시작 번호'),
      categoryId: z.string().optional().describe('카테고리 ID (CID) - 특정 카테고리로 검색을 제한할 때 사용')
    }
  },
  async ({ maxResults, start, categoryId }) => {
    try {
      const params: any = {
        QueryType: 'ItemNewSpecial',
        MaxResults: maxResults,
        start: start,
        SearchTarget: 'Book',
        Cover: 'Big'
      };

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
        pages: item.subInfo?.itemPage || undefined,
        pricePerPage: (item.priceStandard > 0 && item.subInfo?.itemPage > 0) 
          ? parseFloat((item.priceStandard / item.subInfo.itemPage).toFixed(2)) 
          : undefined
      })) || [];

      const categoryText = categoryId ? ` (카테고리: ${categoryId})` : '';
      
      return {
        content: [{
          type: 'text',
          text: `⭐ 주목할 만한 신간 리스트${categoryText}\n\n검색된 도서 수: ${books.length}권\n\n${JSON.stringify(books, null, 2)}`
        }]
      };
    } catch (error) {
      logger.error(`주목할 만한 신간 리스트 조회 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `주목할 만한 신간 리스트 조회 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 편집자 추천 리스트 도구 등록
server.registerTool(
  'get_editor_choice',
  {
    title: '편집자 추천 리스트',
    description: '알라딘 편집자 추천 리스트를 조회합니다. 카테고리별로 검색할 수 있습니다.',
    inputSchema: {
      maxResults: z.number().min(1).max(100).default(10).describe('최대 결과 개수'),
      start: z.number().min(1).default(1).describe('검색 시작 번호'),
      categoryId: z.string().optional().describe('카테고리 ID (CID) - 특정 카테고리로 검색을 제한할 때 사용')
    }
  },
  async ({ maxResults, start, categoryId }) => {
    try {
      const params: any = {
        QueryType: 'ItemEditorChoice',
        MaxResults: maxResults,
        start: start,
        SearchTarget: 'Book',
        Cover: 'Big'
      };

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
        pages: item.subInfo?.itemPage || undefined,
        pricePerPage: (item.priceStandard > 0 && item.subInfo?.itemPage > 0) 
          ? parseFloat((item.priceStandard / item.subInfo.itemPage).toFixed(2)) 
          : undefined
      })) || [];

      const categoryText = categoryId ? ` (카테고리: ${categoryId})` : '';
      
      return {
        content: [{
          type: 'text',
          text: `👨‍💼 편집자 추천 리스트${categoryText}\n\n검색된 도서 수: ${books.length}권\n\n${JSON.stringify(books, null, 2)}`
        }]
      };
    } catch (error) {
      logger.error(`편집자 추천 리스트 조회 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `편집자 추천 리스트 조회 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
);

// 블로거 베스트셀러 도구 등록
server.registerTool(
  'get_blogger_best',
  {
    title: '블로거 베스트셀러',
    description: '알라딘 블로거 베스트셀러 목록을 조회합니다. 국내도서만 조회 가능하며, 카테고리별로 검색할 수 있습니다.',
    inputSchema: {
      maxResults: z.number().min(1).max(100).default(10).describe('최대 결과 개수'),
      start: z.number().min(1).default(1).describe('검색 시작 번호'),
      categoryId: z.string().optional().describe('카테고리 ID (CID) - 특정 카테고리로 검색을 제한할 때 사용')
    }
  },
  async ({ maxResults, start, categoryId }) => {
    try {
      const params: any = {
        QueryType: 'BlogBest',
        MaxResults: maxResults,
        start: start,
        SearchTarget: 'Book',
        Cover: 'Big'
      };

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
        pages: item.subInfo?.itemPage || undefined,
        pricePerPage: (item.priceStandard > 0 && item.subInfo?.itemPage > 0) 
          ? parseFloat((item.priceStandard / item.subInfo.itemPage).toFixed(2)) 
          : undefined
      })) || [];

      const categoryText = categoryId ? ` (카테고리: ${categoryId})` : '';
      
      return {
        content: [{
          type: 'text',
          text: `📝 블로거 베스트셀러${categoryText} (국내도서만)\n\n검색된 도서 수: ${books.length}권\n\n${JSON.stringify(books, null, 2)}`
        }]
      };
    } catch (error) {
      logger.error(`블로거 베스트셀러 조회 중 오류 발생: ${error}`);
      return {
        content: [{
          type: 'text',
          text: `블로거 베스트셀러 조회 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`
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