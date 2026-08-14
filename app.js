import { BaseApp } from '@zeppos/zml/base-app';

App(
  BaseApp({
    onCreate(options) {
      console.log('[liftosaur] app onCreate');
    },
    onDestroy(options) {
      console.log('[liftosaur] app onDestroy');
    },
  })
);
