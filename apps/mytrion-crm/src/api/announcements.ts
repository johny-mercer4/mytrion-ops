import { request, requestMultipart } from './transport';

export type AnnouncementPriority = 'normal' | 'high';
export type AnnouncementDepartment =
  | 'sales'
  | 'customer-service'
  | 'billing'
  | 'finance'
  | 'collection'
  | 'mobile'
  | 'verification';

export interface MytrionAnnouncementDto {
  id: string;
  title: string;
  body: string;
  targetDepartments: AnnouncementDepartment[];
  priority: AnnouncementPriority;
  createdByUserId: string;
  publishedAt: string;
  createdAt: string;
  read?: boolean;
  readAt?: string | null;
  viewCount?: number;
}

interface AnnouncementListResponse {
  announcements: MytrionAnnouncementDto[];
}

export interface AnnouncementAsset {
  fileId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  url: string;
  expiresAt: string;
}

export interface AnnouncementAssetDownload {
  id: string;
  name: string;
  mime: string;
  url: string;
  expiresAt: string;
}

export async function listManagerAnnouncements(): Promise<MytrionAnnouncementDto[]> {
  const data = (await request('GET', '/manager/announcements')) as AnnouncementListResponse;
  return data.announcements;
}

export async function publishManagerAnnouncement(input: {
  title: string;
  body: string;
  targetDepartments: AnnouncementDepartment[];
  priority: AnnouncementPriority;
}): Promise<MytrionAnnouncementDto> {
  const data = (await request('POST', '/manager/announcements', { body: input })) as {
    announcement: MytrionAnnouncementDto;
  };
  return data.announcement;
}

export async function listAnnouncements(): Promise<MytrionAnnouncementDto[]> {
  const data = (await request('GET', '/announcements')) as AnnouncementListResponse;
  return data.announcements;
}

export async function markAnnouncementRead(id: string): Promise<void> {
  await request('POST', `/announcements/${encodeURIComponent(id)}/read`);
}

export async function recordAnnouncementView(id: string): Promise<void> {
  await request('POST', `/announcements/${encodeURIComponent(id)}/view`);
}

export async function uploadAnnouncementAsset(file: File): Promise<AnnouncementAsset> {
  const form = new FormData();
  form.append('file', file);
  const data = (await requestMultipart('/files/upload', form)) as { file: AnnouncementAsset };
  return data.file;
}

export async function getAnnouncementAssetDownload(
  fileId: string,
): Promise<AnnouncementAssetDownload> {
  return (await request(
    'GET',
    `/files/${encodeURIComponent(fileId)}/download`,
  )) as AnnouncementAssetDownload;
}
