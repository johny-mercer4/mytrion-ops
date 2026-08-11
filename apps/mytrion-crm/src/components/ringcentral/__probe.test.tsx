/* TEMPORARY probe — delete after the review. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';

vi.mock('@/api/ringcentral', () => ({
  fetchRingCentralEmbedConfig: vi.fn(async () => ({
    enabled: true,
    clientId: 'cid',
    serverUrl: 'https://platform.ringcentral.com',
    adapterUrl: 'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js?clientId=cid',
  })),
  postRingCentralCallEvent: vi.fn(async () => {}),
}));

import { RingCentralPhone } from './RingCentralPhone';

const SCRIPT_ID = 'mytrion-rc-embeddable-adapter';

/** Faithful-enough stand-in for the vendor bootstrap: builds #rc-widget > iframe, sets RCAdapter. */
function runVendorBootstrap(): void {
  const root = document.createElement('div');
  root.id = 'rc-widget';
  root.className = 'Adapter_root Adapter_right';
  const frame = document.createElement('iframe');
  frame.id = 'rc-widget-adapter-frame';
  frame.src = 'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/app.html';
  root.appendChild(frame);
  document.body.appendChild(root);
  (window as unknown as { RCAdapter?: unknown }).RCAdapter = {
    clickToCall: () => {},
    setMinimized: () => {},
    setClosed: () => {},
  };
}

/** Watch for our script injection and simulate the vendor loading + bootstrapping. */
let vendorObserver: MutationObserver | null = null;
let bootstraps = 0;
function armVendor(): void {
  vendorObserver = new MutationObserver(() => {
    const s = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!s || s.dataset.simulated === '1') return;
    s.dataset.simulated = '1';
    // vendor script "loads"
    s.dispatchEvent(new Event('load'));
    bootstraps += 1;
    runVendorBootstrap();
  });
  vendorObserver.observe(document.body, { childList: true, subtree: true });
}

function Nav({ to }: { to: string }) {
  const navigate = useNavigate();
  useEffect(() => {
    if (to) navigate(to);
  }, [to, navigate]);
  return null;
}

function Harness({ to }: { to: string }) {
  return (
    <>
      <Nav to={to} />
      <RingCentralPhone />
    </>
  );
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe('probe: mount / teardown / remount', () => {
  beforeEach(() => {
    bootstraps = 0;
    delete (window as unknown as { RCAdapter?: unknown }).RCAdapter;
    document.body.innerHTML = '';
    armVendor();
  });
  afterEach(() => {
    vendorObserver?.disconnect();
    vendorObserver = null;
  });

  it('mounts on Sales, tears down on Billing, remounts on return to Sales', async () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/main/salesmytrion']}>
        <Routes>
          <Route path="*" element={<Harness to="" />} />
        </Routes>
      </MemoryRouter>,
    );

    await flush();
    await flush();
    console.log('AFTER SALES MOUNT:', {
      script: !!document.getElementById(SCRIPT_ID),
      widget: !!document.getElementById('rc-widget'),
      frame: !!document.getElementById('rc-widget-adapter-frame'),
      rcAdapter: !!(window as unknown as { RCAdapter?: unknown }).RCAdapter,
      bootstraps,
    });
    expect(document.getElementById('rc-widget-adapter-frame')).not.toBeNull();

    // → Billing
    rerender(
      <MemoryRouter initialEntries={['/main/billingmytrion']}>
        <Routes>
          <Route path="*" element={<Harness to="" />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    console.log('AFTER BILLING:', {
      script: !!document.getElementById(SCRIPT_ID),
      widget: !!document.getElementById('rc-widget'),
      frame: !!document.getElementById('rc-widget-adapter-frame'),
      rcAdapter: !!(window as unknown as { RCAdapter?: unknown }).RCAdapter,
      bootstraps,
    });

    // → back to Sales
    rerender(
      <MemoryRouter initialEntries={['/main/salesmytrion']}>
        <Routes>
          <Route path="*" element={<Harness to="" />} />
        </Routes>
      </MemoryRouter>,
    );
    await flush();
    await flush();
    await flush();
    console.log('AFTER RETURN TO SALES:', {
      script: !!document.getElementById(SCRIPT_ID),
      widget: !!document.getElementById('rc-widget'),
      frame: !!document.getElementById('rc-widget-adapter-frame'),
      rcAdapter: !!(window as unknown as { RCAdapter?: unknown }).RCAdapter,
      bootstraps,
    });
  });
});
