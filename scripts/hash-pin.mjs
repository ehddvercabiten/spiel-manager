import bcrypt from "bcryptjs";
const pin=process.argv[2];
if(!pin||pin.length<8){console.error("Use an admin PIN/passphrase of at least 8 characters.");process.exit(1);}
console.log(await bcrypt.hash(pin,12));