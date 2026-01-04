import { describe, it, expect } from 'vitest';
import { JobPosting } from './jobPosting.domain.js';

describe('JobPosting 도메인', () => {
  describe('생성', () => {
    it('필수 필드로 JobPosting을 생성할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');
      const id = 'job-001';

      // When
      const job = JobPosting.create({
        id,
        title: 'Senior Software Engineer',
        sourcePlatform: 'Booking',
        company: 'Booking.com',
        sourceUrl: 'https://jobs.booking.com/booking/jobs/12345',
        crawledAt: now,
      });

      // Then
      expect(job.id).toBe(id);
      expect(job.title).toBe('Senior Software Engineer');
      expect(job.company).toBe('Booking.com');
      expect(job.sourceUrl).toBe('https://jobs.booking.com/booking/jobs/12345');
      expect(job.crawledAt).toBe('2025-01-15T10:00:00.000Z');
    });

    it('선택적 필드를 포함하여 생성할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When
      const job = JobPosting.create({
        id: 'job-002',
        title: 'Backend Developer',
        sourcePlatform: 'Tencent',
        company: 'Tencent',
        sourceUrl: 'https://careers.tencent.com/jobs/123',
        crawledAt: now,
        externalId: 'TC-123',
        location: 'Shenzhen, China',
        department: 'Cloud Services',
        employmentType: '정규직',
        experienceLevel: '3-5년',
        salary: '협의',
        description: '백엔드 개발 담당',
        requirements: ['Go 경험', 'Kubernetes 경험'],
        responsibilities: ['API 개발', '시스템 설계'],
        benefits: ['스톡옵션', '유연근무'],
        postedDate: '2025-01-10',
        closingDate: '2025-02-10',
      });

      // Then
      expect(job.externalId).toBe('TC-123');
      expect(job.location).toBe('Shenzhen, China');
      expect(job.department).toBe('Cloud Services');
      expect(job.requirements).toEqual(['Go 경험', 'Kubernetes 경험']);
    });

    it('title이 빈 문자열이면 에러를 발생시킨다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        JobPosting.create({
          id: 'job-003',
          title: '',
          sourcePlatform: 'Booking',
          company: 'Booking.com',
          sourceUrl: 'https://jobs.booking.com/jobs/123',
          crawledAt: now,
        })
      ).toThrow('직무명은 필수입니다');
    });

    it('company가 빈 문자열이면 에러를 발생시킨다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        JobPosting.create({
          id: 'job-004',
          title: 'Developer',
          sourcePlatform: 'Booking',
          company: '',
          sourceUrl: 'https://jobs.booking.com/jobs/123',
          crawledAt: now,
        })
      ).toThrow('회사명은 필수입니다');
    });

    it('sourceUrl이 유효하지 않으면 에러를 발생시킨다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');

      // When & Then
      expect(() =>
        JobPosting.create({
          id: 'job-005',
          title: 'Developer',
          sourcePlatform: 'Booking',
          company: 'Booking.com',
          sourceUrl: 'not-a-valid-url',
          crawledAt: now,
        })
      ).toThrow('유효한 URL이 필요합니다');
    });
  });

  describe('JSON 직렬화', () => {
    it('toJSON으로 직렬화할 수 있다', () => {
      // Given
      const now = new Date('2025-01-15T10:00:00Z');
      const job = JobPosting.create({
        id: 'job-001',
        title: 'Senior Software Engineer',
        sourcePlatform: 'Booking',
        company: 'Booking.com',
        sourceUrl: 'https://jobs.booking.com/booking/jobs/12345',
        crawledAt: now,
        location: 'Amsterdam',
      });

      // When
      const json = job.toJSON();

      // Then
      expect(json).toEqual({
        id: 'job-001',
        title: 'Senior Software Engineer',
        company: 'Booking.com',
        sourceUrl: 'https://jobs.booking.com/booking/jobs/12345',
        crawledAt: '2025-01-15T10:00:00.000Z',
        location: 'Amsterdam',
      });
    });
  });
});
