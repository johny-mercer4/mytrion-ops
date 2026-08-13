import { request } from './transport';

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
}

interface AnnouncementListResponse {
  announcements: MytrionAnnouncementDto[];
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

export async function listSalesAnnouncements(): Promise<MytrionAnnouncementDto[]> {
  const data = (await request('GET', '/announcements')) as AnnouncementListResponse;
  return data.announcements;
}

export async function markSalesAnnouncementRead(id: string): Promise<void> {
  await request('POST', `/announcements/${encodeURIComponent(id)}/read`);
}
