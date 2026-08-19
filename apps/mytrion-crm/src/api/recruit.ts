import { request, requestMultipart } from './transport';

export type RecruitJobStatus = 'draft' | 'open' | 'paused' | 'closed';
export type RecruitEmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship';
export type RecruitCandidateStage =
  | 'new'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'hired'
  | 'rejected';

export interface RecruitJobDto {
  id: string;
  openingCode: string | null;
  title: string;
  departmentId: string;
  departmentName: string;
  hiringManagerEmployeeId: string | null;
  employmentType: RecruitEmploymentType;
  location: string | null;
  status: RecruitJobStatus;
  headcount: number;
  description: string | null;
  openedAt: string | null;
  closedAt: string | null;
  candidateCount: number;
  hiredCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RecruitJobInput {
  openingCode?: string | null;
  title: string;
  departmentId: string;
  hiringManagerEmployeeId?: string | null;
  employmentType?: RecruitEmploymentType;
  location?: string | null;
  status?: RecruitJobStatus;
  headcount?: number;
  description?: string | null;
}

export interface RecruitCandidateDto {
  id: string;
  jobOpeningId: string;
  jobTitle: string;
  departmentId: string;
  departmentName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  stage: RecruitCandidateStage;
  source: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  notes: string | null;
  appliedAt: string;
  convertedEmployeeId: string | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Resume metadata (bytes live in Dropbox). Null until one is uploaded. */
  resume: {
    fileName: string | null;
    contentType: string | null;
    uploadedAt: string | null;
  } | null;
}

export interface RecruitCandidateInput {
  jobOpeningId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  stage?: RecruitCandidateStage;
  source?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  notes?: string | null;
}

export interface RecruitSettingsDto {
  id: string;
  defaultLocation: string | null;
  employeeIdPrefix: string;
  defaultEmployeeStatus: string;
  createdAt: string;
  updatedAt: string;
}

export async function listRecruitJobs(signal?: AbortSignal): Promise<RecruitJobDto[]> {
  const data = await request('GET', '/recruit/jobs', {
    ...(signal ? { signal } : {}),
  });
  return (data as { items: RecruitJobDto[] }).items;
}

export async function createRecruitJob(body: RecruitJobInput): Promise<RecruitJobDto> {
  return (await request('POST', '/recruit/jobs', { body })) as RecruitJobDto;
}

export async function updateRecruitJob(
  id: string,
  body: Partial<RecruitJobInput>,
): Promise<RecruitJobDto> {
  return (await request('PATCH', `/recruit/jobs/${encodeURIComponent(id)}`, {
    body,
  })) as RecruitJobDto;
}

export async function deleteRecruitJob(id: string): Promise<void> {
  await request('DELETE', `/recruit/jobs/${encodeURIComponent(id)}`);
}

export async function listRecruitCandidates(
  filters: {
    q?: string;
    stage?: RecruitCandidateStage;
    jobOpeningId?: string;
  } = {},
  signal?: AbortSignal,
): Promise<RecruitCandidateDto[]> {
  const data = await request('GET', '/recruit/candidates', {
    query: filters,
    ...(signal ? { signal } : {}),
  });
  return (data as { items: RecruitCandidateDto[] }).items;
}

export async function createRecruitCandidate(
  body: RecruitCandidateInput,
): Promise<RecruitCandidateDto> {
  return (await request('POST', '/recruit/candidates', { body })) as RecruitCandidateDto;
}

export async function updateRecruitCandidate(
  id: string,
  body: Partial<RecruitCandidateInput>,
): Promise<RecruitCandidateDto> {
  return (await request('PATCH', `/recruit/candidates/${encodeURIComponent(id)}`, {
    body,
  })) as RecruitCandidateDto;
}

export async function deleteRecruitCandidate(id: string): Promise<void> {
  await request('DELETE', `/recruit/candidates/${encodeURIComponent(id)}`);
}

export async function convertRecruitCandidate(
  id: string,
  body: {
    employeeId?: string | null;
    designation?: string | null;
    location?: string | null;
    dateOfJoining?: string | null;
    mobile?: string | null;
  },
): Promise<{ candidateId: string; employeeId: string }> {
  return (await request(
    'POST',
    `/recruit/candidates/${encodeURIComponent(id)}/convert`,
    { body },
  )) as { candidateId: string; employeeId: string };
}

/** Upload a resume for a candidate → a new per-candidate folder in the Recruit Dropbox root. */
export async function uploadCandidateResume(
  id: string,
  file: File,
): Promise<RecruitCandidateDto> {
  const form = new FormData();
  form.append('file', file, file.name);
  return (await requestMultipart(
    `/recruit/candidates/${encodeURIComponent(id)}/resume`,
    form,
  )) as RecruitCandidateDto;
}

/** A short-lived viewable link to the candidate's resume (minted on demand; Dropbox links expire). */
export async function getCandidateResumeLink(
  id: string,
): Promise<{ url: string; expiresAt: string; fileName: string | null }> {
  return (await request(
    'GET',
    `/recruit/candidates/${encodeURIComponent(id)}/resume/link`,
  )) as { url: string; expiresAt: string; fileName: string | null };
}

export async function deleteCandidateResume(id: string): Promise<RecruitCandidateDto> {
  return (await request(
    'DELETE',
    `/recruit/candidates/${encodeURIComponent(id)}/resume`,
  )) as RecruitCandidateDto;
}

export async function getRecruitSettings(signal?: AbortSignal): Promise<RecruitSettingsDto> {
  return (await request('GET', '/recruit/settings', {
    ...(signal ? { signal } : {}),
  })) as RecruitSettingsDto;
}

export async function updateRecruitSettings(
  body: Partial<
    Pick<RecruitSettingsDto, 'defaultLocation' | 'employeeIdPrefix' | 'defaultEmployeeStatus'>
  >,
): Promise<RecruitSettingsDto> {
  return (await request('PATCH', '/recruit/settings', { body })) as RecruitSettingsDto;
}
