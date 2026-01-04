// 직무 정보를 담는 값 객체

export interface JobPostingProps {
  id: string;
  title: string;
  sourcePlatform: string; // 크롤링 소스 (사람인, 원티드 등)
  company: string; // 실제 채용 회사명
  sourceUrl: string;
  crawledAt: Date;
  externalId?: string;
  location?: string;
  department?: string; // 부서/팀 (optional)
  employmentType?: string;
  experienceLevel?: string;
  salary?: string;
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  benefits?: string[];
  postedDate?: string;
  closingDate?: string;
}

export interface JobPostingJSON {
  id: string;
  title: string;
  sourcePlatform: string; // 크롤링 소스 (사람인, 원티드 등)
  company: string; // 실제 채용 회사명
  sourceUrl: string;
  crawledAt: string;
  externalId?: string;
  location?: string;
  department?: string; // 부서/팀 (optional)
  employmentType?: string;
  experienceLevel?: string;
  salary?: string;
  description?: string;
  requirements?: string[];
  responsibilities?: string[];
  benefits?: string[];
  postedDate?: string;
  closingDate?: string;
}

export class JobPosting {
  private constructor(
    public readonly id: string,
    public readonly title: string,
    public readonly sourcePlatform: string,
    public readonly company: string,
    public readonly sourceUrl: string,
    public readonly crawledAt: string,
    public readonly externalId?: string,
    public readonly location?: string,
    public readonly department?: string,
    public readonly employmentType?: string,
    public readonly experienceLevel?: string,
    public readonly salary?: string,
    public readonly description?: string,
    public readonly requirements?: string[],
    public readonly responsibilities?: string[],
    public readonly benefits?: string[],
    public readonly postedDate?: string,
    public readonly closingDate?: string
  ) {}

  static create(props: JobPostingProps): JobPosting {
    // 유효성 검사
    if (!props.title || props.title.trim() === '') {
      throw new Error('직무명은 필수입니다');
    }

    if (!props.sourcePlatform || props.sourcePlatform.trim() === '') {
      throw new Error('크롤링 소스는 필수입니다');
    }

    if (!props.company || props.company.trim() === '') {
      throw new Error('회사명은 필수입니다');
    }

    if (!this.isValidUrl(props.sourceUrl)) {
      throw new Error('유효한 URL이 필요합니다');
    }

    return new JobPosting(
      props.id,
      props.title,
      props.sourcePlatform,
      props.company,
      props.sourceUrl,
      props.crawledAt.toISOString(),
      props.externalId,
      props.location,
      props.department,
      props.employmentType,
      props.experienceLevel,
      props.salary,
      props.description,
      props.requirements,
      props.responsibilities,
      props.benefits,
      props.postedDate,
      props.closingDate
    );
  }

  private static isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  toJSON(): JobPostingJSON {
    const json: JobPostingJSON = {
      id: this.id,
      title: this.title,
      sourcePlatform: this.sourcePlatform,
      company: this.company,
      sourceUrl: this.sourceUrl,
      crawledAt: this.crawledAt,
    };

    // 선택적 필드는 값이 있을 때만 포함
    if (this.externalId !== undefined) json.externalId = this.externalId;
    if (this.location !== undefined) json.location = this.location;
    if (this.department !== undefined) json.department = this.department;
    if (this.employmentType !== undefined) json.employmentType = this.employmentType;
    if (this.experienceLevel !== undefined) json.experienceLevel = this.experienceLevel;
    if (this.salary !== undefined) json.salary = this.salary;
    if (this.description !== undefined) json.description = this.description;
    if (this.requirements !== undefined) json.requirements = this.requirements;
    if (this.responsibilities !== undefined) json.responsibilities = this.responsibilities;
    if (this.benefits !== undefined) json.benefits = this.benefits;
    if (this.postedDate !== undefined) json.postedDate = this.postedDate;
    if (this.closingDate !== undefined) json.closingDate = this.closingDate;

    return json;
  }
}
