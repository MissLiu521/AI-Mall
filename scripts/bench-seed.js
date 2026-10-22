/** 首次启动耗时拆分：migrate 与 seed 各占多少 */
const t0 = Date.now();
const { migrate, seed } = await import('../server/src/db/seed.js');
const t1 = Date.now();
migrate();
const t2 = Date.now();
const r = seed();
const t3 = Date.now();
console.log(`import  ${t1 - t0}ms`);
console.log(`migrate ${t2 - t1}ms`);
console.log(`seed    ${t3 - t2}ms  ${JSON.stringify(r)}`);
