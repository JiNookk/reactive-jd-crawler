// 페이지 구조를 기반으로 데이터 추출
import { Page } from 'playwright';
import { PageStructure, ListPageSelectors, DetailPageSelectors } from '../../domain/pageStructure.domain.js';
import { JobPosting } from '../../domain/jobPosting.domain.js';

export interface ExtractedJobData {
  title?: string;
  location?: string;
  department?: string;
  detailUrl?: string;
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  salary?: string;
  employmentType?: string;
  experienceLevel?: string;
  postedDate?: string;
  closingDate?: string;
  externalId?: string;
}

export class DataExtractor {
  // 목록 페이지에서 직무 데이터 추출
  // startIndex: 무한 스크롤에서 이미 추출한 아이템을 스킵하기 위한 시작 인덱스
  async extractFromListPage(
    page: Page,
    structure: PageStructure,
    company: string,
    startIndex: number = 0
  ): Promise<JobPosting[]> {
    if (structure.pageType !== 'list') {
      throw new Error('목록 페이지 구조가 아닙니다');
    }

    const selectors = structure.selectors as ListPageSelectors;
    const jobs: JobPosting[] = [];
    const now = new Date();

    // 직무 항목들 찾기
    const jobItems = await page.$$(selectors.jobItem);

    // startIndex 이후의 아이템만 처리 (무한 스크롤 최적화)
    for (let i = startIndex; i < jobItems.length; i++) {
      const item = jobItems[i];
      if (!item) continue;

      try {
        const data: ExtractedJobData = {};

        // 각 필드 추출
        if (selectors.title) {
          data.title = await this.extractText(item, selectors.title);
        }

        if (selectors.location) {
          data.location = await this.extractText(item, selectors.location);
        }

        if (selectors.department) {
          data.department = await this.extractText(item, selectors.department);
        }

        if (selectors.detailLink) {
          const href = await this.extractHref(item, selectors.detailLink);
          if (href) {
            // 상대 URL을 절대 URL로 변환
            data.detailUrl = new URL(href, page.url()).href;
          }
        }

        // 제목이 없으면 건너뛰기
        if (!data.title) {
          continue;
        }

        const id = `${company.toLowerCase().replace(/\s+/g, '-')}-${i}-${Date.now()}`;
        const sourceUrl = data.detailUrl || page.url();

        const job = JobPosting.create({
          id,
          title: data.title,
          company,
          sourceUrl,
          crawledAt: now,
          location: data.location,
          department: data.department,
        });

        jobs.push(job);
      } catch (error) {
        console.warn(`직무 항목 ${i} 추출 실패:`, error);
      }
    }

    return jobs;
  }

  // 상세 페이지에서 직무 데이터 추출
  async extractFromDetailPage(
    page: Page,
    structure: PageStructure,
    company: string,
    existingJob?: Partial<JobPosting>
  ): Promise<JobPosting> {
    if (structure.pageType !== 'detail') {
      throw new Error('상세 페이지 구조가 아닙니다');
    }

    const selectors = structure.selectors as DetailPageSelectors;
    const now = new Date();
    const data: ExtractedJobData = {};

    // 각 필드 추출
    if (selectors.title) {
      data.title = await this.extractTextFromPage(page, selectors.title);
    }

    if (selectors.location) {
      data.location = await this.extractTextFromPage(page, selectors.location);
    }

    if (selectors.department) {
      data.department = await this.extractTextFromPage(page, selectors.department);
    }

    if (selectors.description) {
      data.description = await this.extractTextFromPage(page, selectors.description);
    }

    if (selectors.requirements) {
      data.requirements = await this.extractListFromPage(page, selectors.requirements);
    }

    if (selectors.responsibilities) {
      data.responsibilities = await this.extractListFromPage(page, selectors.responsibilities);
    }

    if (selectors.salary) {
      data.salary = await this.extractTextFromPage(page, selectors.salary);
    }

    if (selectors.employmentType) {
      data.employmentType = await this.extractTextFromPage(page, selectors.employmentType);
    }

    if (selectors.experienceLevel) {
      data.experienceLevel = await this.extractTextFromPage(page, selectors.experienceLevel);
    }

    if (selectors.postedDate) {
      data.postedDate = await this.extractTextFromPage(page, selectors.postedDate);
    }

    if (selectors.closingDate) {
      data.closingDate = await this.extractTextFromPage(page, selectors.closingDate);
    }

    // 기존 데이터와 병합
    const title = data.title || existingJob?.title;
    if (!title) {
      throw new Error('직무명을 찾을 수 없습니다');
    }

    const id = existingJob?.id || `${company.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;

    return JobPosting.create({
      id,
      title,
      company,
      sourceUrl: page.url(),
      crawledAt: now,
      location: data.location || existingJob?.location,
      department: data.department || existingJob?.department,
      description: data.description,
      requirements: data.requirements,
      responsibilities: data.responsibilities,
      salary: data.salary,
      employmentType: data.employmentType,
      experienceLevel: data.experienceLevel,
      postedDate: data.postedDate,
      closingDate: data.closingDate,
    });
  }

  // 셀렉터로 데이터 추출 시도, 실패하면 null 반환
  async tryExtract(page: Page, selectors: ListPageSelectors | DetailPageSelectors): Promise<boolean> {
    try {
      // jobItem이나 title 중 하나라도 찾으면 성공
      const jobItemSelector = (selectors as ListPageSelectors).jobItem;
      const titleSelector = selectors.title;

      if (jobItemSelector) {
        const items = await page.$$(jobItemSelector);
        if (items.length > 0) return true;
      }

      if (titleSelector) {
        const title = await page.$(titleSelector);
        if (title) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private async extractText(element: any, selector: string): Promise<string | undefined> {
    try {
      const el = await element.$(selector);
      if (!el) return undefined;
      const text = await el.textContent();
      return text?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async extractHref(element: any, selector: string): Promise<string | undefined> {
    try {
      const el = await element.$(selector);
      if (!el) return undefined;
      const href = await el.getAttribute('href');
      return href || undefined;
    } catch {
      return undefined;
    }
  }

  private async extractTextFromPage(page: Page, selector: string): Promise<string | undefined> {
    try {
      const el = await page.$(selector);
      if (!el) return undefined;
      const text = await el.textContent();
      return text?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async extractListFromPage(page: Page, selector: string): Promise<string[] | undefined> {
    try {
      const elements = await page.$$(selector);
      if (elements.length === 0) return undefined;

      const texts: string[] = [];
      for (const el of elements) {
        const text = await el.textContent();
        if (text?.trim()) {
          texts.push(text.trim());
        }
      }

      return texts.length > 0 ? texts : undefined;
    } catch {
      return undefined;
    }
  }
}
