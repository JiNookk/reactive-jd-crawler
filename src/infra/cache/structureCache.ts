// 페이지 구조 캐시 저장/로드
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PageStructure, PageStructureJSON } from '../../domain/pageStructure.domain.js';

const DEFAULT_CACHE_PATH = '.cache/structures.json';

export interface StructureCacheData {
  [cacheKey: string]: PageStructureJSON;
}

// 캐시 통계 타입
export interface CacheStats {
  totalHits: number;
  totalMisses: number;
  hitsByDomain: Map<string, number>;
  missesByDomain: Map<string, number>;
}

// 로그 레벨
export type LogLevel = 'none' | 'summary' | 'verbose';

export class StructureCache {
  private cache: Map<string, PageStructure> = new Map();
  private loaded = false;
  private logLevel: LogLevel = 'summary';

  // 통계 추적
  private stats: CacheStats = {
    totalHits: 0,
    totalMisses: 0,
    hitsByDomain: new Map(),
    missesByDomain: new Map(),
  };

  constructor(private readonly cachePath: string = DEFAULT_CACHE_PATH) {}

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  private log(message: string, level: 'summary' | 'verbose' = 'summary'): void {
    if (this.logLevel === 'none') return;
    if (this.logLevel === 'summary' && level === 'verbose') return;
    console.log(message);
  }

  private extractDomain(cacheKey: string): string {
    // cacheKey 형식: "domain.com/path" → "domain.com" 추출
    const slashIndex = cacheKey.indexOf('/');
    return slashIndex > 0 ? cacheKey.substring(0, slashIndex) : cacheKey;
  }

  private recordHit(cacheKey: string): void {
    this.stats.totalHits++;
    const domain = this.extractDomain(cacheKey);
    this.stats.hitsByDomain.set(
      domain,
      (this.stats.hitsByDomain.get(domain) || 0) + 1
    );
  }

  private recordMiss(cacheKey: string): void {
    this.stats.totalMisses++;
    const domain = this.extractDomain(cacheKey);
    this.stats.missesByDomain.set(
      domain,
      (this.stats.missesByDomain.get(domain) || 0) + 1
    );
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const content = await readFile(this.cachePath, 'utf-8');
      const data: StructureCacheData = JSON.parse(content);

      for (const [key, json] of Object.entries(data)) {
        this.cache.set(key, PageStructure.fromJSON(json));
      }

      this.loaded = true;
    } catch (error) {
      // 파일이 없으면 빈 캐시로 시작
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loaded = true;
        return;
      }
      throw error;
    }
  }

  async save(): Promise<void> {
    const data: StructureCacheData = {};

    for (const [key, structure] of this.cache.entries()) {
      data[key] = structure.toJSON();
    }

    // 디렉토리 생성
    await mkdir(dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  get(cacheKey: string, now: Date = new Date()): PageStructure | null {
    const structure = this.cache.get(cacheKey);

    if (!structure) {
      this.recordMiss(cacheKey);
      this.log(`[Cache MISS] ${cacheKey}`, 'verbose');
      return null;
    }

    // 만료 확인
    if (structure.isExpired(now)) {
      this.cache.delete(cacheKey);
      this.recordMiss(cacheKey);
      this.log(`[Cache MISS] ${cacheKey} (expired)`, 'verbose');
      return null;
    }

    // 캐시 히트 기록 및 메타데이터 업데이트
    this.recordHit(cacheKey);
    const updatedStructure = structure.recordHit(now);
    this.cache.set(cacheKey, updatedStructure);
    this.log(`[Cache HIT] ${cacheKey}`, 'verbose');

    return updatedStructure;
  }

  set(cacheKey: string, structure: PageStructure): void {
    this.cache.set(cacheKey, structure);
  }

  /**
   * 추출 실패를 기록하고, 연속 실패 시 자동 무효화
   * @returns 캐시가 무효화되었으면 true
   */
  recordFailure(cacheKey: string): boolean {
    const structure = this.cache.get(cacheKey);
    if (!structure) return false;

    const updatedStructure = structure.recordFail();

    if (updatedStructure.shouldInvalidate()) {
      this.cache.delete(cacheKey);
      this.log(`[Cache INVALIDATED] ${cacheKey} (연속 ${updatedStructure.metadata.failCount}회 실패)`);
      return true;
    }

    this.cache.set(cacheKey, updatedStructure);
    this.log(
      `[Cache FAIL] ${cacheKey} (실패 ${updatedStructure.metadata.failCount}/3)`,
      'verbose'
    );
    return false;
  }

  has(cacheKey: string, now: Date = new Date()): boolean {
    return this.get(cacheKey, now) !== null;
  }

  delete(cacheKey: string): boolean {
    return this.cache.delete(cacheKey);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  // 통계 관련 메서드
  getStats(): CacheStats {
    return {
      totalHits: this.stats.totalHits,
      totalMisses: this.stats.totalMisses,
      hitsByDomain: new Map(this.stats.hitsByDomain),
      missesByDomain: new Map(this.stats.missesByDomain),
    };
  }

  getHitRate(): number {
    const total = this.stats.totalHits + this.stats.totalMisses;
    if (total === 0) return 0;
    return this.stats.totalHits / total;
  }

  printStats(): void {
    const hitRate = this.getHitRate();
    const total = this.stats.totalHits + this.stats.totalMisses;

    console.log('\n📊 캐시 통계');
    console.log('─'.repeat(40));
    console.log(`총 조회: ${total}회`);
    console.log(`  • 히트: ${this.stats.totalHits}회`);
    console.log(`  • 미스: ${this.stats.totalMisses}회`);
    console.log(`히트율: ${(hitRate * 100).toFixed(1)}%`);

    if (this.stats.hitsByDomain.size > 0 || this.stats.missesByDomain.size > 0) {
      console.log('\n도메인별 통계:');

      // 모든 도메인 수집
      const allDomains = new Set([
        ...this.stats.hitsByDomain.keys(),
        ...this.stats.missesByDomain.keys(),
      ]);

      for (const domain of allDomains) {
        const hits = this.stats.hitsByDomain.get(domain) || 0;
        const misses = this.stats.missesByDomain.get(domain) || 0;
        const domainTotal = hits + misses;
        const domainHitRate = domainTotal > 0 ? (hits / domainTotal) * 100 : 0;

        console.log(`  ${domain}: ${hits}/${domainTotal} (${domainHitRate.toFixed(1)}%)`);
      }
    }

    console.log('─'.repeat(40));
  }

  resetStats(): void {
    this.stats = {
      totalHits: 0,
      totalMisses: 0,
      hitsByDomain: new Map(),
      missesByDomain: new Map(),
    };
  }

  // 캐시 엔트리별 메타데이터 조회
  getAllEntries(): Array<{ cacheKey: string; structure: PageStructure }> {
    return Array.from(this.cache.entries()).map(([cacheKey, structure]) => ({
      cacheKey,
      structure,
    }));
  }
}
