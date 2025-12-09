// 페이지 구조 캐시 저장/로드
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PageStructure, PageStructureJSON } from '../../domain/pageStructure.domain.js';

const DEFAULT_CACHE_PATH = '.cache/structures.json';

export interface StructureCacheData {
  [cacheKey: string]: PageStructureJSON;
}

export class StructureCache {
  private cache: Map<string, PageStructure> = new Map();
  private loaded = false;

  constructor(private readonly cachePath: string = DEFAULT_CACHE_PATH) {}

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
      return null;
    }

    // 만료 확인
    if (structure.isExpired(now)) {
      this.cache.delete(cacheKey);
      return null;
    }

    return structure;
  }

  set(cacheKey: string, structure: PageStructure): void {
    this.cache.set(cacheKey, structure);
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
}
