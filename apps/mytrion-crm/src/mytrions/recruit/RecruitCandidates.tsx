import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import { canWriteMytrion, isAdmin } from '../../access/resolveAccess';
import {
  convertRecruitCandidate,
  createRecruitCandidate,
  deleteCandidateResume,
  deleteRecruitCandidate,
  getCandidateResumeLink,
  listRecruitCandidates,
  listRecruitJobs,
  updateRecruitCandidate,
  uploadCandidateResume,
  type RecruitCandidateDto,
  type RecruitCandidateStage,
  type RecruitJobDto,
} from '../../api/recruit';
import { useUserContext } from '../../context/UserContextProvider';
import {
  RecruitEmpty,
  RecruitError,
  RecruitHead,
  RecruitLoader,
  RecruitModal,
} from './RecruitBits';

interface CandidateDraft {
  jobOpeningId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  stage: RecruitCandidateStage;
  source: string;
  currentCompany: string;
  currentTitle: string;
  notes: string;
}

interface ConvertDraft {
  employeeId: string;
  designation: string;
  location: string;
  dateOfJoining: string;
  mobile: string;
}

const stages: RecruitCandidateStage[] = [
  'new',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
];

const blankCandidate = (): CandidateDraft => ({
  jobOpeningId: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  stage: 'new',
  source: '',
  currentCompany: '',
  currentTitle: '',
  notes: '',
});

const toDraft = (candidate: RecruitCandidateDto): CandidateDraft => ({
  jobOpeningId: candidate.jobOpeningId,
  firstName: candidate.firstName,
  lastName: candidate.lastName,
  email: candidate.email ?? '',
  phone: candidate.phone ?? '',
  stage: candidate.stage,
  source: candidate.source ?? '',
  currentCompany: candidate.currentCompany ?? '',
  currentTitle: candidate.currentTitle ?? '',
  notes: candidate.notes ?? '',
});

export function RecruitCandidates() {
  const user = useUserContext();
  const admin = isAdmin(user);
  const canWrite = canWriteMytrion(user, 'recruit');
  const [candidates, setCandidates] = useState<RecruitCandidateDto[]>([]);
  const [jobs, setJobs] = useState<RecruitJobDto[]>([]);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<RecruitCandidateStage | 'all'>('all');
  const [jobId, setJobId] = useState('');
  const [editing, setEditing] = useState<RecruitCandidateDto | 'new' | null>(null);
  const [draft, setDraft] = useState<CandidateDraft>(blankCandidate);
  const [converting, setConverting] = useState<RecruitCandidateDto | null>(null);
  const [convertDraft, setConvertDraft] = useState<ConvertDraft>({
    employeeId: '',
    designation: '',
    location: '',
    dateOfJoining: new Date().toISOString().slice(0, 10),
    mobile: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  /** Candidate id whose resume is uploading / being removed — disables that row's control. */
  const [resumeBusyId, setResumeBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [candidateRows, jobRows] = await Promise.all([
        listRecruitCandidates(),
        listRecruitJobs(),
      ]);
      setCandidates(candidateRows);
      setJobs(jobRows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return candidates.filter((candidate) => {
      if (stage !== 'all' && candidate.stage !== stage) return false;
      if (jobId && candidate.jobOpeningId !== jobId) return false;
      if (!needle) return true;
      return [
        candidate.firstName,
        candidate.lastName,
        candidate.email,
        candidate.jobTitle,
        candidate.departmentName,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [candidates, jobId, query, stage]);

  const saveCandidate = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = {
        ...draft,
        email: draft.email || null,
        phone: draft.phone || null,
        source: draft.source || null,
        currentCompany: draft.currentCompany || null,
        currentTitle: draft.currentTitle || null,
        notes: draft.notes || null,
      };
      if (editing === 'new') await createRecruitCandidate(body);
      else if (editing) await updateRecruitCandidate(editing.id, body);
      setEditing(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const advanceStage = async (
    candidate: RecruitCandidateDto,
    next: RecruitCandidateStage,
  ): Promise<void> => {
    setError('');
    try {
      await updateRecruitCandidate(candidate.id, { stage: next });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const uploadResume = async (candidate: RecruitCandidateDto, file: File): Promise<void> => {
    setResumeBusyId(candidate.id);
    setError('');
    setSuccess('');
    try {
      await uploadCandidateResume(candidate.id, file);
      setSuccess(`Resume uploaded for ${candidate.firstName} ${candidate.lastName}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setResumeBusyId(null);
    }
  };

  const viewResume = async (candidate: RecruitCandidateDto): Promise<void> => {
    setError('');
    try {
      const { url } = await getCandidateResumeLink(candidate.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const removeResume = async (candidate: RecruitCandidateDto): Promise<void> => {
    if (!window.confirm(`Remove the resume for ${candidate.firstName} ${candidate.lastName}?`)) return;
    setResumeBusyId(candidate.id);
    setError('');
    try {
      await deleteCandidateResume(candidate.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setResumeBusyId(null);
    }
  };

  const openConvert = (candidate: RecruitCandidateDto): void => {
    setConvertDraft({
      employeeId: '',
      designation: candidate.currentTitle ?? '',
      location: '',
      dateOfJoining: new Date().toISOString().slice(0, 10),
      mobile: candidate.phone ?? '',
    });
    setConverting(candidate);
  };

  const convert = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!converting) return;
    setSaving(true);
    setError('');
    try {
      await convertRecruitCandidate(converting.id, {
        employeeId: convertDraft.employeeId || null,
        designation: convertDraft.designation || null,
        location: convertDraft.location || null,
        dateOfJoining: convertDraft.dateOfJoining || null,
        mobile: convertDraft.mobile || null,
      });
      setSuccess(`${converting.firstName} ${converting.lastName} is now an HR employee.`);
      setConverting(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (candidate: RecruitCandidateDto): Promise<void> => {
    if (!window.confirm(`Delete ${candidate.firstName} ${candidate.lastName}?`)) return;
    try {
      await deleteRecruitCandidate(candidate.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (loading) return <RecruitLoader label="Loading candidates" />;

  return (
    <div className="recruit-page">
      <RecruitHead
        eyebrow="Candidate pipeline"
        title="Candidates"
        description="Review applicants, move them through the pipeline, and convert accepted candidates into Mytrion HR employees."
        actions={canWrite ? (
          <button
            type="button"
            className="recruit-btn recruit-btn-primary"
            onClick={() => {
              setDraft(blankCandidate());
              setEditing('new');
            }}
          >
            <Plus size={16} /> Add candidate
          </button>
        ) : null}
      />
      <RecruitError message={error} />
      {success ? <div className="recruit-success"><UserRoundCheck size={18} />{success}</div> : null}

      <section className="recruit-filterbar">
        <label>
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search candidates…" />
        </label>
        <select value={stage} onChange={(e) => setStage(e.target.value as RecruitCandidateStage | 'all')} aria-label="Filter by stage">
          <option value="all">All stages</option>
          {stages.map((value) => <option value={value} key={value}>{value}</option>)}
        </select>
        <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Filter by opening">
          <option value="">All job openings</option>
          {jobs.map((job) => <option value={job.id} key={job.id}>{job.title}</option>)}
        </select>
        <span>{visible.length} candidates</span>
      </section>

      {visible.length === 0 ? (
        <RecruitEmpty
          icon={<UsersRound size={28} />}
          title="No candidates match"
          body="Adjust the filters or add a candidate to an open role."
        />
      ) : (
        <section className="recruit-candidate-list">
          {visible.map((candidate) => (
            <article className="recruit-candidate" key={candidate.id}>
              <span className="recruit-avatar">
                {candidate.firstName[0]}{candidate.lastName[0]}
              </span>
              <div className="recruit-candidate-main">
                <div>
                  <h2>{candidate.firstName} {candidate.lastName}</h2>
                  <span className={`recruit-stage recruit-stage-${candidate.stage}`}>{candidate.stage}</span>
                </div>
                <p>
                  <BriefcaseBusiness size={14} />{candidate.jobTitle}
                  <span>·</span>{candidate.departmentName}
                </p>
                {candidate.email ? <small><Mail size={13} />{candidate.email}</small> : null}
                <div className="recruit-resume">
                  {candidate.resume ? (
                    <button
                      type="button"
                      className="recruit-resume-link"
                      onClick={() => void viewResume(candidate)}
                    >
                      <FileText size={13} />
                      {candidate.resume.fileName ?? 'Résumé'}
                    </button>
                  ) : (
                    <span className="recruit-resume-none"><FileText size={13} />No résumé</span>
                  )}
                  {canWrite && !candidate.convertedEmployeeId ? (
                    <>
                      <label
                        className="recruit-resume-action"
                        title={candidate.resume ? 'Replace résumé' : 'Upload résumé'}
                      >
                        {resumeBusyId === candidate.id ? (
                          <Loader2 size={13} className="recruit-spin" />
                        ) : (
                          <Upload size={13} />
                        )}
                        {candidate.resume ? 'Replace' : 'Upload'}
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.rtf,.txt,application/pdf"
                          hidden
                          disabled={resumeBusyId === candidate.id}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) void uploadResume(candidate, file);
                          }}
                        />
                      </label>
                      {candidate.resume ? (
                        <button
                          type="button"
                          className="recruit-resume-action"
                          onClick={() => void removeResume(candidate)}
                          disabled={resumeBusyId === candidate.id}
                        >
                          Remove
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
              <div className="recruit-candidate-actions">
                {canWrite && !candidate.convertedEmployeeId ? (
                  <>
                    <select
                      value={candidate.stage}
                      onChange={(e) => void advanceStage(candidate, e.target.value as RecruitCandidateStage)}
                      aria-label={`Stage for ${candidate.firstName}`}
                    >
                      {stages.filter((value) => value !== 'hired').map((value) => (
                        <option value={value} key={value}>{value}</option>
                      ))}
                    </select>
                    <button type="button" className="recruit-icon-btn" onClick={() => {
                      setDraft(toDraft(candidate));
                      setEditing(candidate);
                    }} aria-label="Edit candidate"><Pencil size={16} /></button>
                    <button type="button" className="recruit-icon-btn" onClick={() => void remove(candidate)} aria-label="Delete candidate"><Trash2 size={16} /></button>
                  </>
                ) : null}
                {admin && !candidate.convertedEmployeeId ? (
                  <button type="button" className="recruit-btn recruit-convert" onClick={() => openConvert(candidate)}>
                    Convert to employee <ArrowRight size={15} />
                  </button>
                ) : null}
                {candidate.convertedEmployeeId ? (
                  <span className="recruit-converted"><ShieldCheck size={16} />HR employee</span>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}

      {editing ? (
        <RecruitModal
          title={editing === 'new' ? 'Add candidate' : 'Edit candidate'}
          subtitle="Candidate data remains connected to its original job opening and department."
          onClose={() => setEditing(null)}
        >
          <form className="recruit-form" onSubmit={(event) => void saveCandidate(event)}>
            <div className="recruit-form-grid">
              <label className="recruit-field recruit-field-wide"><span>Job opening</span><select required value={draft.jobOpeningId} onChange={(e) => setDraft({ ...draft, jobOpeningId: e.target.value })}><option value="">Choose opening…</option>{jobs.filter((job) => job.status !== 'closed').map((job) => <option key={job.id} value={job.id}>{job.title} · {job.departmentName}</option>)}</select></label>
              <label className="recruit-field"><span>First name</span><input required value={draft.firstName} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} /></label>
              <label className="recruit-field"><span>Last name</span><input required value={draft.lastName} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} /></label>
              <label className="recruit-field"><span>Email</span><input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></label>
              <label className="recruit-field"><span>Phone</span><input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></label>
              <label className="recruit-field"><span>Current title</span><input value={draft.currentTitle} onChange={(e) => setDraft({ ...draft, currentTitle: e.target.value })} /></label>
              <label className="recruit-field"><span>Current company</span><input value={draft.currentCompany} onChange={(e) => setDraft({ ...draft, currentCompany: e.target.value })} /></label>
              <label className="recruit-field"><span>Source</span><input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="Referral, LinkedIn…" /></label>
              <label className="recruit-field"><span>Stage</span><select value={draft.stage} onChange={(e) => setDraft({ ...draft, stage: e.target.value as RecruitCandidateStage })}>{stages.filter((value) => value !== 'hired').map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="recruit-field recruit-field-wide"><span>Notes</span><textarea rows={4} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            </div>
            <footer className="recruit-form-actions"><button type="button" className="recruit-btn" onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="recruit-btn recruit-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save candidate'}</button></footer>
          </form>
        </RecruitModal>
      ) : null}

      {converting ? (
        <RecruitModal
          title={`Hire ${converting.firstName} ${converting.lastName}`}
          subtitle="This creates a real employee in Mytrion HR. Candidate and employee records are committed together."
          onClose={() => setConverting(null)}
        >
          <form className="recruit-form" onSubmit={(event) => void convert(event)}>
            <div className="recruit-callout"><ShieldCheck size={20} /><div><strong>Admin-controlled conversion</strong><p>The employee inherits {converting.departmentName} from the job opening. A unique employee ID is generated when left blank.</p></div></div>
            <div className="recruit-form-grid">
              <label className="recruit-field"><span>Employee ID</span><input value={convertDraft.employeeId} onChange={(e) => setConvertDraft({ ...convertDraft, employeeId: e.target.value })} placeholder="Generated automatically" /></label>
              <label className="recruit-field"><span>Designation</span><input value={convertDraft.designation} onChange={(e) => setConvertDraft({ ...convertDraft, designation: e.target.value })} /></label>
              <label className="recruit-field"><span>Location</span><input value={convertDraft.location} onChange={(e) => setConvertDraft({ ...convertDraft, location: e.target.value })} placeholder="Use Recruit default" /></label>
              <label className="recruit-field"><span>Joining date</span><input type="date" value={convertDraft.dateOfJoining} onChange={(e) => setConvertDraft({ ...convertDraft, dateOfJoining: e.target.value })} /></label>
              <label className="recruit-field recruit-field-wide"><span>Mobile</span><input value={convertDraft.mobile} onChange={(e) => setConvertDraft({ ...convertDraft, mobile: e.target.value })} /></label>
            </div>
            <footer className="recruit-form-actions"><button type="button" className="recruit-btn" onClick={() => setConverting(null)}>Cancel</button><button type="submit" className="recruit-btn recruit-btn-primary" disabled={saving}><UserRoundCheck size={16} />{saving ? 'Creating employee…' : 'Create HR employee'}</button></footer>
          </form>
        </RecruitModal>
      ) : null}
    </div>
  );
}
