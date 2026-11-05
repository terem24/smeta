const app = require('./env.js');
const log = console.log; console.log = () => {};
const run = (t, o, pro) => {
  app.isPro = () => pro; app.installerSettings = Object.assign(app.installerSettings || {}, { poolCoils: undefined });
  app.__setup(o);
  const html = app.poolTeaserHtml();
  log(t, '| isPro', pro, '| stats', JSON.stringify(app._poolStats), '| плашка:', html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '—');
};
const base = { area: 150, floors: 2, systems: ['rad', 'tp'], tp1: 60, hotWater: true, res: 4 };
run('МП + МП', Object.assign({ pipeType: 'split_mp', ufhPipeMaterial: 'metal_plastic' }, base), false);
run('МП + МП', Object.assign({ pipeType: 'split_mp', ufhPipeMaterial: 'metal_plastic' }, base), true);
run('изол. + PEX', Object.assign({ pipeType: 'insulated', ufhPipeMaterial: 'pex' }, base), false);
