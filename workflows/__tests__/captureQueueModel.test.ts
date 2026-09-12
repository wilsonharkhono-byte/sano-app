import { WEB_QUEUE_WARNING } from '../screens/siteEvent/captureQueueModel';

describe('WEB_QUEUE_WARNING', () => {
  it('states the exact web limitation from spec §7', () => {
    expect(WEB_QUEUE_WARNING).toBe('Di web, kiriman tidak tersimpan bila halaman ditutup. Gunakan aplikasi Android di lapangan.');
  });
});
