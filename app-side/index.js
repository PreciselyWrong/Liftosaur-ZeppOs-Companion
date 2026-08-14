import { BaseSideService } from '@zeppos/zml/base-side';
import { createSideRouter } from './router.js';

const router = createSideRouter();

AppSideService(
  BaseSideService({
    onInit() {
      console.log('[liftosaur-side] onInit');
    },

    onRequest(req, res) {
      console.log('[liftosaur-side] onRequest', JSON.stringify(req));
      router
        .handle(req)
        .then((response) => {
          console.log('[liftosaur-side] response', JSON.stringify(response));
          res(null, response);
        })
        .catch((err) => {
          console.log('[liftosaur-side] error', err?.message || String(err));
          res({ code: 500, message: err?.message || 'Internal error' });
        });
    },

    onRun() {
      console.log('[liftosaur-side] onRun');
    },

    onDestroy() {
      console.log('[liftosaur-side] onDestroy');
    },
  })
);
