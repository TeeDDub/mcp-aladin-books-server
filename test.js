#!/usr/bin/env node

import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

console.log('MCP 서버 테스트 시작...');

// 테스트 클라이언트 생성
const client = new Client({
  name: 'test-client',
  version: '1.0.0'
});

// 서버 시작
const transport = new StdioClientTransport({
  command: 'node',
  args: ['dist/index.js'],
  env: {
    ...process.env,
    ALADIN_TTB_KEY: process.env.ALADIN_TTB_KEY || 'test_key'
  }
});

try {
  console.log('서버 연결 중...');
  await client.connect(transport);
  console.log('✅ 서버 연결 성공');

  // 도구 목록 확인
  const tools = await client.listTools();
  console.log('✅ 사용 가능한 도구:', tools.tools.map(t => t.name));

  console.log('✅ 모든 테스트 통과');
} catch (error) {
  console.error('❌ 테스트 실패:', error.message);
  process.exit(1);
} finally {
  await client.close();
} 