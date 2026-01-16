// CSV 파싱/생성 유틸리티

/**
 * CSV 행을 파싱하여 문자열 배열로 반환
 * - 쌍따옴표로 감싼 필드 지원
 * - 이스케이프된 따옴표("") 처리
 */
export function parseCsvRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    const nextChar = row[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
  }

  result.push(current);
  return result;
}

/**
 * 값을 CSV 형식으로 이스케이프
 * - 쉼표, 따옴표, 줄바꿈 포함 시 따옴표로 감싸기
 */
export function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV 전체 내용을 파싱하여 2차원 배열로 반환
 * - BOM 자동 제거
 * - 빈 줄 무시
 */
export function parseCsv(content: string): string[][] {
  const cleanContent = content.replace(/^\uFEFF/, ''); // BOM 제거
  const lines = cleanContent.split('\n').filter((line) => line.trim());
  return lines.map((line) => parseCsvRow(line));
}

/**
 * 2차원 배열을 CSV 문자열로 변환
 */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
}
