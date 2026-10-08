export class DemandFrames{
 constructor(){this.dirty=true;}
 invalidate(){this.dirty=true;}
 consume(animated,visible=true){if(!visible)return false;if(!animated&&!this.dirty)return false;this.dirty=false;return true;}
}
