import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  BriefcaseBusiness,
  Building2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { canWriteMytrion } from '../../access/resolveAccess';
import { listHrDepartments, type HrDepartmentDto } from '../../api/hr';
import {
  createRecruitJob,
  deleteRecruitJob,
  listRecruitJobs,
  updateRecruitJob,
  type RecruitEmploymentType,
  type RecruitJobDto,
  type RecruitJobStatus,
} from '../../api/recruit';
import { useUserContext } from '../../context/UserContextProvider';
import {
  RecruitEmpty,
  RecruitError,
  RecruitHead,
  RecruitLoader,
  RecruitModal,
} from './RecruitBits';

interface JobDraft {
  openingCode: string;
  title: string;
  departmentId: string;
  employmentType: RecruitEmploymentType;
  location: string;
  status: RecruitJobStatus;
  headcount: number;
  description: string;
}

const blankJob = (): JobDraft => ({
  openingCode: '',
  title: '',
  departmentId: '',
  employmentType: 'full_time',
  location: '',
  status: 'draft',
  headcount: 1,
  description: '',
});

const jobDraft = (job: RecruitJobDto): JobDraft => ({
  openingCode: job.openingCode ?? '',
  title: job.title,
  departmentId: job.departmentId,
  employmentType: job.employmentType,
  location: job.location ?? '',
  status: job.status,
  headcount: job.headcount,
  description: job.description ?? '',
});

export function RecruitJobs() {
  const user = useUserContext();
  const canWrite = canWriteMytrion(user, 'recruit');
  const [jobs, setJobs] = useState<RecruitJobDto[]>([]);
  const [departments, setDepartments] = useState<HrDepartmentDto[]>([]);
  const [editing, setEditing] = useState<RecruitJobDto | 'new' | null>(null);
  const [draft, setDraft] = useState<JobDraft>(blankJob);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [jobRows, departmentRows] = await Promise.all([
        listRecruitJobs(),
        listHrDepartments({ limit: 500 }),
      ]);
      setJobs(jobRows);
      setDepartments(departmentRows.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = (): void => {
    setDraft(blankJob());
    setEditing('new');
  };
  const openEdit = (job: RecruitJobDto): void => {
    setDraft(jobDraft(job));
    setEditing(job);
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!draft.departmentId || !draft.title.trim()) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        openingCode: draft.openingCode || null,
        title: draft.title,
        departmentId: draft.departmentId,
        employmentType: draft.employmentType,
        location: draft.location || null,
        status: draft.status,
        headcount: draft.headcount,
        description: draft.description || null,
      };
      if (editing === 'new') await createRecruitJob(body);
      else if (editing) await updateRecruitJob(editing.id, body);
      setEditing(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (job: RecruitJobDto): Promise<void> => {
    if (!window.confirm(`Delete the ${job.title} opening?`)) return;
    setError('');
    try {
      await deleteRecruitJob(job.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (loading) return <RecruitLoader label="Loading job openings" />;

  return (
    <div className="recruit-page">
      <RecruitHead
        eyebrow="Workforce planning"
        title="Job openings"
        description="Every opening belongs to a real Mytrion HR department, keeping hiring and the employee directory aligned."
        actions={canWrite ? (
          <button type="button" className="recruit-btn recruit-btn-primary" onClick={openNew}>
            <Plus size={16} /> New opening
          </button>
        ) : null}
      />
      <RecruitError message={error} />

      {jobs.length === 0 ? (
        <RecruitEmpty
          icon={<BriefcaseBusiness size={28} />}
          title="No job openings yet"
          body="Create the first role and connect it to the department that will own the hire."
        />
      ) : (
        <section className="recruit-job-grid">
          {jobs.map((job) => (
            <article className="recruit-job-card" key={job.id}>
              <div className="recruit-job-card-top">
                <span className={`recruit-status recruit-status-${job.status}`}>{job.status}</span>
                {canWrite ? (
                  <div className="recruit-row-actions">
                    <button type="button" onClick={() => openEdit(job)} aria-label="Edit opening">
                      <Pencil size={15} />
                    </button>
                    <button type="button" onClick={() => void remove(job)} aria-label="Delete opening">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : null}
              </div>
              <small>{job.openingCode || 'OPENING'}</small>
              <h2>{job.title}</h2>
              <p>{job.description || 'No role description has been added yet.'}</p>
              <div className="recruit-job-meta">
                <span><Building2 size={15} />{job.departmentName}</span>
                <span><MapPin size={15} />{job.location || 'Flexible'}</span>
                <span><UsersRound size={15} />{job.candidateCount} candidates</span>
              </div>
              <footer>
                <span>{job.employmentType.replace('_', ' ')}</span>
                <span>{job.hiredCount} / {job.headcount} hired</span>
              </footer>
            </article>
          ))}
        </section>
      )}

      {editing ? (
        <RecruitModal
          title={editing === 'new' ? 'Create job opening' : 'Edit job opening'}
          subtitle="Connect this role to the department that will receive the successful hire."
          onClose={() => setEditing(null)}
        >
          <form className="recruit-form" onSubmit={(event) => void save(event)}>
            <div className="recruit-form-grid">
              <label className="recruit-field recruit-field-wide">
                <span>Job title</span>
                <input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="recruit-field">
                <span>Opening code</span>
                <input value={draft.openingCode} onChange={(e) => setDraft({ ...draft, openingCode: e.target.value })} placeholder="REC-001" />
              </label>
              <label className="recruit-field">
                <span>Department</span>
                <select required value={draft.departmentId} onChange={(e) => setDraft({ ...draft, departmentId: e.target.value })}>
                  <option value="">Choose department…</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
              </label>
              <label className="recruit-field">
                <span>Employment type</span>
                <select value={draft.employmentType} onChange={(e) => setDraft({ ...draft, employmentType: e.target.value as RecruitEmploymentType })}>
                  <option value="full_time">Full time</option>
                  <option value="part_time">Part time</option>
                  <option value="contract">Contract</option>
                  <option value="internship">Internship</option>
                </select>
              </label>
              <label className="recruit-field">
                <span>Status</span>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as RecruitJobStatus })}>
                  <option value="draft">Draft</option>
                  <option value="open">Open</option>
                  <option value="paused">Paused</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className="recruit-field">
                <span>Location</span>
                <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
              </label>
              <label className="recruit-field">
                <span>Headcount</span>
                <input type="number" min={1} value={draft.headcount} onChange={(e) => setDraft({ ...draft, headcount: Number(e.target.value) })} />
              </label>
              <label className="recruit-field recruit-field-wide">
                <span>Description</span>
                <textarea rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
            </div>
            <footer className="recruit-form-actions">
              <button type="button" className="recruit-btn" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="recruit-btn recruit-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Save opening'}
              </button>
            </footer>
          </form>
        </RecruitModal>
      ) : null}
    </div>
  );
}
