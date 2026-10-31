import {test as base,expect} from '@playwright/test';
import {localUiUrl} from './ui-tests.mjs';
export const test=base;
export {expect};
test.beforeEach(async({context})=>{
 await context.route('**/*',route=>localUiUrl(route.request().url())?route.continue():route.abort());
 await context.routeWebSocket('**/*',socket=>localUiUrl(socket.url())?socket.connectToServer():socket.close());
});
