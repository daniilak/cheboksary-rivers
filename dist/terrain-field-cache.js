// Compare physical bed state before touching the much larger display mesh.
export class TerrainFieldCache{
 changed(field,key){
  const bed=field.bed,change=field.sediment?.change;
  let changed=this.key!==key||this.bed?.length!==bed.length||this.change?.length!==change?.length;
  if(!changed)for(let k=0;k<bed.length;k++)if(bed[k]!==this.bed[k]||(change&&change[k]!==this.change[k])){changed=true;break;}
  if(changed){this.key=key;this.bed=bed.slice();this.change=change?.slice();}
  return changed;
 }
}
