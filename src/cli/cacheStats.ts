#!/usr/bin/env node
// 캐시 통계 CLI
import { StructureCache } from '../infra/cache/structureCache.js';

interface CacheEntry {
  domain: string;
  path: string;
  pageType: string;
  version: number;
  hitCount: number;
  lastHitAt: string | null;
  failCount: number;
  analyzedAt: string;
  expiresAt: string;
  isExpired: boolean;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || 'stats';

  const cache = new StructureCache();
  cache.setLogLevel('none');
  await cache.load();

  switch (command) {
    case 'stats':
      printStats(cache);
      break;
    case 'list':
      printList(cache);
      break;
    case 'detail':
      const cacheKey = args[1];
      if (!cacheKey) {
        console.error('에러: 캐시 키가 필요합니다.');
        console.log('사용법: pnpm cache:stats detail <cache-key>');
        process.exit(1);
      }
      printDetail(cache, cacheKey);
      break;
    case 'clear':
      await clearCache(cache);
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

function printStats(cache: StructureCache): void {
  const entries = cache.getAllEntries();
  const now = new Date();

  console.log('\n📊 캐시 통계 요약');
  console.log('═'.repeat(50));

  if (entries.length === 0) {
    console.log('캐시가 비어있습니다.');
    console.log('═'.repeat(50));
    return;
  }

  // 기본 통계
  const totalEntries = entries.length;
  const expiredEntries = entries.filter((e) => e.structure.isExpired(now)).length;
  const activeEntries = totalEntries - expiredEntries;

  console.log(`\n총 캐시 엔트리: ${totalEntries}개`);
  console.log(`  • 활성: ${activeEntries}개`);
  console.log(`  • 만료: ${expiredEntries}개`);

  // 도메인별 통계
  const domainStats = new Map<string, { count: number; hits: number; fails: number }>();

  for (const { cacheKey, structure } of entries) {
    const domain = extractDomain(cacheKey);
    const existing = domainStats.get(domain) || { count: 0, hits: 0, fails: 0 };
    domainStats.set(domain, {
      count: existing.count + 1,
      hits: existing.hits + structure.metadata.hitCount,
      fails: existing.fails + structure.metadata.failCount,
    });
  }

  console.log('\n도메인별 현황:');
  for (const [domain, stats] of domainStats.entries()) {
    console.log(`  ${domain}: ${stats.count}개 (히트: ${stats.hits}, 실패: ${stats.fails})`);
  }

  // 버전 통계
  const versionStats = new Map<number, number>();
  for (const { structure } of entries) {
    const version = structure.metadata.version;
    versionStats.set(version, (versionStats.get(version) || 0) + 1);
  }

  console.log('\n버전별 분포:');
  const sortedVersions = Array.from(versionStats.entries()).sort((a, b) => a[0] - b[0]);
  for (const [version, count] of sortedVersions) {
    console.log(`  v${version}: ${count}개`);
  }

  // 총 히트 카운트
  const totalHits = entries.reduce((sum, e) => sum + e.structure.metadata.hitCount, 0);
  console.log(`\n총 캐시 히트: ${totalHits}회`);

  console.log('═'.repeat(50));
}

function printList(cache: StructureCache): void {
  const entries = cache.getAllEntries();
  const now = new Date();

  console.log('\n📋 캐시 목록');
  console.log('═'.repeat(80));

  if (entries.length === 0) {
    console.log('캐시가 비어있습니다.');
    console.log('═'.repeat(80));
    return;
  }

  console.log(
    padEnd('캐시 키', 40) +
      padEnd('타입', 8) +
      padEnd('버전', 6) +
      padEnd('히트', 6) +
      padEnd('실패', 6) +
      '상태'
  );
  console.log('─'.repeat(80));

  for (const { cacheKey, structure } of entries) {
    const isExpired = structure.isExpired(now);
    const status = isExpired ? '만료' : '활성';
    const shortKey = cacheKey.length > 38 ? cacheKey.slice(0, 35) + '...' : cacheKey;

    console.log(
      padEnd(shortKey, 40) +
        padEnd(structure.pageType, 8) +
        padEnd(`v${structure.metadata.version}`, 6) +
        padEnd(String(structure.metadata.hitCount), 6) +
        padEnd(String(structure.metadata.failCount), 6) +
        status
    );
  }

  console.log('═'.repeat(80));
  console.log(`총 ${entries.length}개 엔트리`);
}

function printDetail(cache: StructureCache, cacheKey: string): void {
  const entries = cache.getAllEntries();
  const entry = entries.find((e) => e.cacheKey === cacheKey);

  if (!entry) {
    console.error(`캐시 키를 찾을 수 없습니다: ${cacheKey}`);
    console.log('\n사용 가능한 캐시 키:');
    entries.forEach((e) => console.log(`  • ${e.cacheKey}`));
    process.exit(1);
  }

  const { structure } = entry;
  const now = new Date();

  console.log('\n📄 캐시 상세 정보');
  console.log('═'.repeat(50));
  console.log(`캐시 키: ${cacheKey}`);
  console.log(`페이지 타입: ${structure.pageType}`);
  console.log(`URL 패턴: ${structure.urlPattern}`);
  console.log(`분석일: ${structure.analyzedAt}`);
  console.log(`만료일: ${structure.expiresAt}`);
  console.log(`상태: ${structure.isExpired(now) ? '만료' : '활성'}`);

  console.log('\n메타데이터:');
  console.log(`  버전: ${structure.metadata.version}`);
  console.log(`  히트 카운트: ${structure.metadata.hitCount}`);
  console.log(`  마지막 히트: ${structure.metadata.lastHitAt || '없음'}`);
  console.log(`  실패 카운트: ${structure.metadata.failCount}`);

  console.log('\n셀렉터:');
  for (const [key, value] of Object.entries(structure.selectors)) {
    if (value) {
      console.log(`  ${key}: ${value}`);
    }
  }

  if (structure.pagination) {
    console.log('\n페이지네이션:');
    console.log(`  타입: ${structure.pagination.type}`);
    if (structure.pagination.nextSelector) {
      console.log(`  다음 버튼: ${structure.pagination.nextSelector}`);
    }
    if (structure.pagination.scrollContainer) {
      console.log(`  스크롤 컨테이너: ${structure.pagination.scrollContainer}`);
    }
    if (structure.pagination.paramName) {
      console.log(`  파라미터: ${structure.pagination.paramName} (시작: ${structure.pagination.paramStart})`);
    }
  }

  console.log('═'.repeat(50));
}

async function clearCache(cache: StructureCache): Promise<void> {
  const entries = cache.getAllEntries();
  const count = entries.length;

  if (count === 0) {
    console.log('캐시가 이미 비어있습니다.');
    return;
  }

  cache.clear();
  await cache.save();

  console.log(`✅ 캐시가 초기화되었습니다. (${count}개 엔트리 삭제)`);
}

function printHelp(): void {
  console.log(`
캐시 통계 CLI

사용법:
  pnpm cache:stats [command] [options]

명령어:
  stats     캐시 통계 요약 표시 (기본)
  list      모든 캐시 엔트리 목록
  detail    특정 캐시 엔트리 상세 정보
  clear     캐시 초기화
  help      도움말 표시

예시:
  pnpm cache:stats              # 통계 요약
  pnpm cache:stats list         # 목록 표시
  pnpm cache:stats detail jobs.booking.com/booking/jobs
  pnpm cache:stats clear        # 캐시 초기화
`);
}

function extractDomain(cacheKey: string): string {
  const slashIndex = cacheKey.indexOf('/');
  return slashIndex > 0 ? cacheKey.substring(0, slashIndex) : cacheKey;
}

function padEnd(str: string, length: number): string {
  if (str.length >= length) return str;
  return str + ' '.repeat(length - str.length);
}

main().catch(console.error);
