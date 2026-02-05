// Tiny benchmark for parser performance.
import { parseUnits } from "./lib/units-parser.js";

const sample = `
App {
  Header (title:'Dashboard')
  #if (@user.loggedIn) {
    List {
      #for (item, i in @items) {
        Card (key:@item.id) {
          text 'Item: '
          @item.name
          Button (label:'Select' !click { set(selected:=@item.id) })
        }
      }
    }
  }
  #slot (footer)
}
`;

const iterations = 2000;
let total = 0;

console.log(`Benchmarking ${iterations} parses...`);
console.time("parseUnits");
for (let i = 0; i < iterations; i++) {
  const t0 = Date.now();
  parseUnits(sample);
  total += Date.now() - t0;
}
console.timeEnd("parseUnits");
console.log(`Avg ms/parse: ${(total / iterations).toFixed(4)}`);
