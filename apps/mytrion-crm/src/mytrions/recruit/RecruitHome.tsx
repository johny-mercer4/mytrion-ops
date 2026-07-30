import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  Sparkles,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import {
  listRecruitCandidates,
  listRecruitJobs,
  type RecruitCandidateDto,
  type RecruitJobDto,
} from '../../api/recruit';
import { RecruitError, RecruitHead, RecruitLoader } from './RecruitBits';
import type { RecruitView } from './RecruitShell';

export function RecruitHome({ onOpen }: { onOpen: (view: RecruitView) => void }) {
  const [jobs, setJobs] = useState<RecruitJobDto[]>([]);
  const [candidates, setCandidates] = useState<RecruitCandidateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [jobRows, candidateRows] = await Promise.all([
        listRecruitJobs(),
        listRecruitCandidates(),
      ]);
      setJobs(jobRows);
      setCandidates(candidateRows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => {
    const active = candidates.filter((candidate) =>
      ['screening', 'interview', 'offer'].includes(candidate.stage),
    ).length;
    return {
      openJobs: jobs.filter((job) => job.status === 'open').length,
      candidates: candidates.length,
      active,
      hired: candidates.filter((candidate) => candidate.stage === 'hired').length,
    };
  }, [candidates, jobs]);

  if (loading) return <RecruitLoader label="Loading Recruit home" />;

  return (
    <main className="recruit-page">
      <RecruitHead
        eyebrow="Talent operations"
        title="Recruiting command center"
        description="Open roles, candidate momentum, and employee conversion in one native Mytrion workflow."
        actions={
          <button type="button" className="recruit-btn" onClick={() => void load()}>
            Refresh
          </button>
        }
      />
      <RecruitError message={error} />

      <section className="recruit-metrics" aria-label="Recruiting summary">
        {[
          {
            label: 'Open roles',
            value: metrics.openJobs,
            detail: 'Actively accepting candidates',
            icon: <BriefcaseBusiness />,
            tone: 'var(--tone-sky)',
          },
          {
            label: 'Candidates',
            value: metrics.candidates,
            detail: 'Across every job opening',
            icon: <UsersRound />,
            tone: 'var(--tone-violet)',
          },
          {
            label: 'In progress',
            value: metrics.active,
            detail: 'Screening through offer',
            icon: <Sparkles />,
            tone: 'var(--tone-amber)',
          },
          {
            label: 'Converted hires',
            value: metrics.hired,
            detail: 'Created in Mytrion HR',
            icon: <UserRoundCheck />,
            tone: 'var(--tone-emerald)',
          },
        ].map((metric) => (
          <article
            className="recruit-metric"
            key={metric.label}
            style={{ ['--recruit-tone' as string]: metric.tone }}
          >
            <span>{metric.icon}</span>
            <div>
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
              <p>{metric.detail}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="recruit-home-grid">
        <article className="recruit-panel recruit-flow">
          <div className="recruit-panel-head">
            <div>
              <span className="recruit-section-label">Native workflow</span>
              <h2>From opening to employee</h2>
            </div>
            <CheckCircle2 size={21} />
          </div>
          <div className="recruit-flow-steps">
            {[
              ['01', 'Open the role', 'Choose an existing Mytrion HR department.'],
              ['02', 'Manage candidates', 'Move applicants through a clear hiring pipeline.'],
              ['03', 'Convert the hire', 'Admin creates the HR employee in one atomic action.'],
              ['04', 'Link Zoho user', 'Attach the Zoho account when it becomes available.'],
            ].map(([step, title, detail]) => (
              <div key={step}>
                <span>{step}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="recruit-panel recruit-quick">
          <span className="recruit-section-label">Quick actions</span>
          <h2>Keep hiring moving</h2>
          <button type="button" onClick={() => onOpen('jobs')}>
            <BriefcaseBusiness size={20} />
            <span>
              <strong>Manage job openings</strong>
              <small>Create roles tied to HR departments</small>
            </span>
            <ArrowRight size={18} />
          </button>
          <button type="button" onClick={() => onOpen('candidates')}>
            <UsersRound size={20} />
            <span>
              <strong>Review candidates</strong>
              <small>Advance, reject, or convert applicants</small>
            </span>
            <ArrowRight size={18} />
          </button>
        </article>
      </section>
    </main>
  );
}
