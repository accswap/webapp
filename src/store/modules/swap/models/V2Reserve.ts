import Token from "./Token";
import Reserve from "./Reserve";

export default class V2Reserve extends Reserve {
  static entity = "v2reserves";
  static baseEntity = "reserves";

  static fields() {
    return {
      ...super.fields(),
      id: this.attr(null),
      pool_token_id: this.attr(null),
      poolToken: this.hasOne(Token, "token_id", "pool_token_id")
    };
  }
}
