import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getStaff } from '@/lib/server';
import { makeT } from '@/lib/i18n';
import { formatMoney, pick } from '@/lib/format';
import type { Period } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PERIODS: Period[] = ['today', '7d', 'season'];
const fmtPct = (v: number | null, na: string) => (v === null ? na : `${v}%`);

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const staff = await getStaff();
  if (!staff) redirect('/admin/login');
  if (staff.info.role !== 'hotel_admin') redirect('/admin');
  const locale = await getLocale(staff.info.hotel.defaultLocale);
  const t = makeT(locale);
  const period: Period = PERIODS.includes(sp.period as Period) ? (sp.period as Period) : '7d';
  const [k, rq] = await Promise.all([staff.kpis(period), staff.requestStats(period).catch(() => null)]);
  const mins = (v: number | null) => (v === null ? t('common.notAvailable') : t('admin.requests.minutes', { n: v }));
  const na = t('common.notAvailable');
  const cap = k.i2.cap;
  const capPct = cap > 0 ? (k.i2.capUsed / cap) * 100 : 0;
  const def = (n: 1 | 2 | 3 | 4 | 5 | 6) => (
    <details className="def"><summary>{t('admin.dashboard.definition')}</summary>{t(`admin.dashboard.i${n}.def`)}</details>
  );
  return (
    <>
      <div className="row-between">
        <h1>{t('admin.dashboard.title')}</h1>
        <nav className="chips" aria-label={t('admin.social.periodLabel')}>
          {PERIODS.map((p) => (
            <Link key={p} href={`/admin/stats?period=${p}`} className={`chip ${p === period ? 'chip-on' : ''}`} aria-current={p === period ? 'page' : undefined}>
              {t(`admin.dashboard.period${p === 'today' ? 'Today' : p === '7d' ? '7d' : 'Season'}`)}
            </Link>
          ))}
        </nav>
      </div>

      {cap > 0 && capPct >= 100 && <p className="notice notice-err" role="alert">{t('admin.dashboard.capAlert100', { used: k.i2.capUsed, cap })}</p>}
      {cap > 0 && capPct >= 80 && capPct < 100 && <p className="notice notice-warn" role="alert">{t('admin.dashboard.capAlert80', { used: k.i2.capUsed, cap })}</p>}

      <div className="kpis">
        <section className="card kpi">
          <h2 className="h3">{t('admin.dashboard.i1.name')}</h2>
          <div className="num">{k.i1.activated}</div>
          <dl><dt>{t('admin.dashboard.activationRate')}</dt><dd>{na}</dd></dl>
          <p className="hint">{t('admin.dashboard.activationRateNa')}</p>
          {def(1)}
        </section>

        <section className="card kpi">
          <h2 className="h3">{t('admin.dashboard.i2.name')}</h2>
          <div className="num">{k.i2.redeemed}</div>
          <dl>
            <dt>{t('admin.dashboard.issued')}</dt><dd>{k.i2.issued}</dd>
            <dt>{t('admin.dashboard.redemptionRate')}</dt><dd>{fmtPct(k.i2.redemptionRatePct, na)}</dd>
            <dt>{t('admin.dashboard.capUsage')}</dt><dd>{k.i2.capUsed}/{cap} ({fmtPct(k.i2.capUsagePct, na)})</dd>
            <dt>{t('admin.dashboard.cost')}</dt><dd>{formatMoney(k.i2.costCents, locale)}</dd>
          </dl>
          <progress className="bar-meter" max={100} value={Math.min(100, Math.round(capPct))} aria-label={t('admin.dashboard.capUsage')} />
          {def(2)}
        </section>

        <section className="card kpi">
          <h2 className="h3">{t('admin.dashboard.i3.name')}</h2>
          <div className="num">{k.i3.bookings}</div>
          <dl>
            {k.i3.perFacility.map((f) => (
              <div key={f.facilityId} className="contents">
                <dt>{t('admin.dashboard.saturation')} · {pick(f.name, locale, 'it')}</dt>
                <dd>{f.saturationPct === null ? na : `${f.saturationPct}% (${f.bookedSeats}/${f.availableSeats})`}</dd>
              </div>
            ))}
          </dl>
          {def(3)}
        </section>

        <section className="card kpi">
          <h2 className="h3">{t('admin.dashboard.i4.name')}</h2>
          <div className="num">{k.i4.totalRsvps}</div>
          <dl>
            {k.i4.events.map((e) => (
              <div key={e.id} className="contents">
                <dt>{pick(e.title, locale, 'it')}</dt>
                <dd>{e.rsvps} · {t('admin.dashboard.attended')}: {e.attended === null ? t('admin.dashboard.attendedNa') : e.attended}</dd>
              </div>
            ))}
          </dl>
          {def(4)}
        </section>

        <section className="card kpi">
          <h2 className="h3">{t('admin.dashboard.i5.name')}</h2>
          <div className="num">{k.i5.resolvedByAi}</div>
          <dl>
            <dt>{t('admin.dashboard.conversations')}</dt><dd>{k.i5.conversations}</dd>
            <dt>{t('admin.dashboard.handoffs')}</dt><dd>{k.i5.handoffs}</dd>
            <dt>{t('admin.dashboard.wrongRate')}</dt><dd>{k.i5.wrongMarked} ({fmtPct(k.i5.wrongRatePct, na)})</dd>
            <dt>{t('admin.dashboard.hoursSaved')}</dt><dd>{k.i5.hoursSavedEstimate} h</dd>
          </dl>
          {def(5)}
        </section>

        <section className="card kpi">
          <h2 className="h3">{t('admin.dashboard.i6.name')}</h2>
          <div className="num">{fmtPct(k.i6.engagedPct, na)}</div>
          <dl>
            <dt>{t('admin.dashboard.engaged24')}</dt><dd>{fmtPct(k.i6.engaged24hPct, na)}</dd>
            <dt>{t('admin.dashboard.engaged72')}</dt><dd>{fmtPct(k.i6.engaged72hPct, na)}</dd>
          </dl>
          {def(6)}
        </section>
      </div>

      {rq && (
        <section className="card kpi" aria-labelledby="st-rq">
          <h2 id="st-rq" className="h3">{t('admin.requests.statsTitle')}</h2>
          <div className="num">{rq.total}</div>
          <dl>
            <dt>{t('admin.requests.statsDone')}</dt><dd>{rq.done}</dd>
            <dt>{t('admin.requests.statsOpen')}</dt><dd>{rq.open}</dd>
            <dt>{t('admin.requests.statsTake')}</dt><dd>{mins(rq.takeMinutes)}</dd>
            <dt>{t('admin.requests.statsDoneTime')}</dt><dd>{mins(rq.doneMinutes)}</dd>
            <dt>{t('admin.requests.statsRating')}</dt><dd>{rq.up + rq.down > 0 ? `${Math.round((rq.up / (rq.up + rq.down)) * 100)}% 👍 (${rq.up + rq.down})` : t('common.notAvailable')}</dd>
          </dl>
          {rq.byCategory.length > 0 && (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>{t('admin.requests.category')}</th><th>{t('admin.requests.statsCount')}</th><th>{t('admin.requests.statsDoneTime')}</th></tr></thead>
              <tbody>{rq.byCategory.map((c, i) => <tr key={i}><td>{c.name.it ?? Object.values(c.name)[0]}</td><td>{c.total}</td><td>{mins(c.doneMinutes)}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
      )}

      <p className="notice notice-warn">{t('admin.dashboard.euroNote')}</p>
      <details className="card card-muted">
        <summary className="h3">{t('admin.dashboard.limitations')}</summary>
        <ul>{k.limitations.map((key) => <li key={key}>{t(key)}</li>)}</ul>
      </details>
      <a className="btn btn-secondary" href={`/api/staff/export?period=${period}`}>{t('admin.dashboard.export')}</a>
    </>
  );
}
