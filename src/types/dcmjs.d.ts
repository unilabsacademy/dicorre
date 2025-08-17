declare module 'dcmjs' {
  export namespace data {
    export class DicomMessage {
      static readFile(buffer: ArrayBuffer): DicomMessage
      static write(dict: any): ArrayBuffer
      constructor(dict: any)
      dict: any
    }
    
    export class DicomMetaDictionary {
      static naturalizeDataset(dict: any): any
    }
  }
}