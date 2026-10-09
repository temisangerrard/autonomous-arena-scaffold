import * as T from './vendor/three.module.min.js';
import { activityBase } from './activity-common.js';
import { createAvatar } from './world.js';

export function createActivity(context) {
  const kind = context.activityKey || context.origin.id;
  const titles = { gallery: 'Your own little exhibition.', museum: 'Piece together the past.', industry: 'Make Manchester move.' };
  const a = activityBase(context, titles[kind], context.origin.name + ' · Imagined interior & original exhibits');
  const b = a.builder;
  b.box(0, -0.2, 0, 18, 0.4, 17, '#d1bea0');
  b.box(0, 4, -6, 18, 8, 0.3, '#eee0c8');
  for (const x of [-8, 8]) b.box(x, 3, 0, 0.3, 6, 12, '#e0ceb0');
  b.box(0, 0.6, 3, 5, 1.2, 1.2, '#796854');
  const visitor = createAvatar(); visitor.setOutfit(context.avatar.getOutfit()); visitor.group.position.set(-5, 0, 3); visitor.group.rotation.y = 0.5; a.group.add(visitor.group);
  let progress = 0, complete = false, speed = 0, steady = 0;
  const moving = new T.Group(); a.group.add(moving);
  const pieces = [];
  if (kind === 'gallery') {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 4.5;
      b.box(x, 3.4, -5.65, 3.7, 3.7, 0.2, '#ad8746');
      b.box(x, 3.4, -5.45, 3.3, 3.3, 0.2, '#fbefd7');
      const art = new T.Mesh(new T.CircleGeometry(1.15, 32), new T.MeshStandardMaterial({ color: ['#b85f55', '#71988b', '#dcad52'][i] }));
      art.position.set(x, 3.5, -5.25); moving.add(art); pieces.push(art);
      b.box(x, 2.65, -5.05, 2.6, 0.18, 0.1, '#435f60', i * 0.2);
    }
    a.ui.actions('<button id="culture-action">Change palette</button><button id="culture-shape">Change shapes</button><button id="culture-finish" class="primary-action">Hang my exhibition</button>');
    let palette = 0, shape = 0;
    a.ui.on('culture-action', () => { palette = (palette + 1) % 3; pieces.forEach((p, i) => p.material.color.set(['#b85f55', '#71988b', '#dcad52'][(i + palette) % 3])); });
    a.ui.on('culture-shape', () => { shape = (shape + 1) % 3; pieces.forEach((p, i) => p.scale.set(shape === 1 ? 0.6 : 1, shape === 2 ? 0.55 + i * 0.15 : 1, 1)); });
    a.ui.on('culture-finish', () => { complete = true; a.ui.caption('Exhibition open', 'Your colours are on the walls. Keep experimenting, or head out to your next stop.'); });
    a.ui.caption('Be the curator', 'Choose a palette and shapes, then hang your original abstract exhibition.');
  } else if (kind === 'museum') {
    b.box(0, 0.4, -1, 10, 0.8, 4, '#80745e');
    const bones = new T.Group(); moving.add(bones);
    const boneMat = new T.MeshStandardMaterial({ color: '#f0dfb6', roughness: 1 });
    const bone = (x, y, z, sx, sy, sz) => { const mesh = new T.Mesh(new T.CapsuleGeometry(0.12, 1, 3, 8), boneMat); mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz); bones.add(mesh); return mesh; };
    const spine = bone(0, 2.6, -1, 1, 5, 1); spine.rotation.z = Math.PI / 2; pieces.push(spine);
    const ribs = new T.Group(); bones.add(ribs); for (let i=0;i<6;i++) { const rib=new T.Mesh(new T.TorusGeometry(0.6,0.065,6,16,Math.PI),boneMat); rib.rotation.y=Math.PI/2; rib.position.set(-1.6+i*0.6,2.2,-1); ribs.add(rib); } pieces.push(ribs);
    const legs = new T.Group(); bones.add(legs); for (const x of [-1.7,1.7]) { const leg=bone(x,1.55,-1,1.6,1.6,1.6); legs.attach(leg); } pieces.push(legs);
    const skull=new T.Mesh(new T.BoxGeometry(1.5,0.8,0.7),boneMat); skull.position.set(3.1,2.65,-1); bones.add(skull); pieces.push(skull);
    pieces.forEach(p => p.visible=false);
    const names=['spine','ribs','legs','skull'];
    a.ui.actions('<button id="culture-action" class="primary-action">Add spine · 1/4</button><button id="culture-reset">Start again</button>');
    a.ui.on('culture-action', () => { if(complete)return; pieces[progress++].visible=true; complete=progress===4; a.ui.root.querySelector('#culture-action').textContent=complete?'Fossil complete ✓':`Add ${names[progress]} · ${progress+1}/4`; a.ui.caption(complete?'A creature takes shape':names[progress-1], complete?'You assembled our imaginary prehistoric creature. Real fossils help researchers investigate ancient life.':'One part at a time: watch the skeleton emerge.'); });
    a.ui.on('culture-reset',()=>{pieces.forEach(p=>p.visible=false);progress=0;complete=false;a.ui.root.querySelector('#culture-action').textContent='Add spine · 1/4';a.ui.caption('Fossil workshop','Build the spine, ribs, legs and skull.');});
    a.ui.caption('Fossil workshop','Build a stylised prehistoric creature, one part at a time.');
  } else {
    b.box(0, 0.5, -1, 7, 1, 4, '#536f67');
    const wheel = new T.Group(); wheel.position.set(0,2.5,0); moving.add(wheel);
    const material=new T.MeshStandardMaterial({color:'#b68a45',metalness:0.5,roughness:0.45});
    wheel.add(new T.Mesh(new T.TorusGeometry(1.7,0.17,8,32),material));
    for(let i=0;i<6;i++){const spoke=new T.Mesh(new T.BoxGeometry(3.2,0.12,0.12),material);spoke.rotation.z=i*Math.PI/6;wheel.add(spoke);}
    a.ui.actions('<label>Engine power <input id="culture-power" type="range" min="0" max="100" value="0"></label><button id="culture-reset">Reset engine</button>');
    a.ui.on('culture-reset',()=>{speed=0;steady=0;complete=false;a.ui.root.querySelector('#culture-power').value='0';a.ui.caption('Engineer’s challenge','Hold power between 55 and 65 for three seconds.');});
    a.ui.root.querySelector('#culture-power').oninput=e=>{speed=Number(e.target.value);};
    a.ui.caption('Engineer’s challenge','Set the power between 55 and 65 and hold it steady for three seconds.');
  }
  a.finish();
  return {
    group:a.group, background:'#d9cfbb',
    update(dt) {
      if(kind==='industry') { moving.children[0].rotation.z-=dt*speed/15; if(!complete){steady=speed>=55&&speed<=65?steady+dt:0; if(steady>=3){complete=true;a.ui.caption('Running smoothly','You brought the model engine to a steady speed. Manchester’s next idea is yours.');}} }
      context.camera.position.set(0,5.8,context.camera.aspect<0.85?30:17);context.camera.lookAt(0,2,-1);
    },
    snapshot(){return {type:kind,progress,complete,speed,steady:+steady.toFixed(2)};},
    dispose:a.dispose,
  };
}
