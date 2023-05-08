import { Logger } from "tslog";
import { Converter } from "./Converter.js";

export class ESSIFConverter implements Converter {
      private log = new Logger();
      
      public constructor() {}
      
      getType(): string {
            return "ESIFF";
      }

      convert(glossary: Map<string, string>, properties: Map<string, string>): string {
            var esiffOut: string = "";
            if (properties.get("scopetag") == "default") {
                  if (properties.get("vsntag") == "latest") {
                        esiffOut = `<Term popup="todo" reference="${properties.get("term")}">${properties.get("showtext")}</Term>`;
                        this.log.info("The esiff term is: " + esiffOut)
                  } else {
                        this.log.error(`No access to version '${properties.get("vsntag")}' of ' ${properties.get("scopetag")}'`);
                        return esiffOut;
                        // TODO go back and get the correct glossary   
                  }
            } else {
                  this.log.error(`No access to scope '${properties.get("scopetag")}'`);
                  return esiffOut;
                  // TODO go back and get the correct glossary
            }
            return esiffOut;
      }

}