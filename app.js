var Mongo = require("mongodb");
var Express = require("express");
var Handlebars = require("express-handlebars");
var BodyParser = require("body-parser");
var HTTPS = require("https");
//var Big = require("big-integer");
var sha1 = require("sha1");



/*
the idea here is to create a "one-click" login/account-creation with mongoDB by working with facebook oauth.
this is a "garbage" project and is a super-rough proof of concept and nothing else.

the current namespaces at play are:

HTTPHelper - misc utility functions that can also be helpful for doing some oauth-specific things
FB - communicating with facebooks servers
DB - communicating with the local mongodb instance
Auth - digital signitures stuff
Server - expressjs server

id like to treat these as autonomous units, but they can depend on eachother in a variety of ways.
so on one hand, this could be solved with nodes native support for modules via require. (none of the above includes are my namespaces, those are just various 3rd party libraries)
on the other hand, id like to know if a more official "legal" and structured declaration of the all
units and their dependencies is how you are "supposed to" do this sort of thing. but perhapse the people that do that are naked emperors.

(ive never run this on different machines before, but in theory, if you fill out FB.Config and DB.Config with the correct values, it *should* work.
and therefore, these should be changed into environment variables rather than hard coded like this.
and not to insult your intelligence, but the mongo server has to be running before node is launched.)
*/



/*
little namespace for http utilities
*/
/*
no dependencies
*/
var HTTPHelper = {};
/*convert a query string to javascript object*/
HTTPHelper.QueryToObj = function(inString)
{
	var parts = inString.split("&");
	var i;
	var part;
	var output = {};
	for(i=0; i<parts.length; i++)
	{
		part = parts[i].split("=");
		output[part[0]] = part[1];
	}
	return output;
};
/*convert a javascript object into a query string*/
HTTPHelper.ObjToQuery = function(inObj)
{
	var output = "";
	for(prop in inObj)
	{
		output += prop + "=" + inObj[prop] + "&";
	}
	return output.substring(0, output.length-1);
};
/*make a get request to inURL and then call inHandler when done. this is https*/
HTTPHelper.GET = function(inURL, inHandler)
{
	HTTPS.get(inURL, function(inHTTPRes)
	{
		var responseBody = "";
		inHTTPRes.on("data", function(inChunk)
		{
			responseBody += inChunk;
		});
		inHTTPRes.on("end", function()
		{
			inHandler(responseBody);
		});
	});
};



/*
namespace for facebook's HTTP API endpoints.
after filling out FB.Config, the three "URL functions" exposed in FB.URL can be used to get a code, an access_token, and user profile, respectively.
*/
/*
It Needs:
HTTPHelper
*/
var FB = {};

FB.Config = {};
FB.Config.AppID = "1628003107468799"; 
FB.Config.AppSecret = "2db01a126ae61f9b885262470c2abc88"; // well, the cats out of the bag...
FB.Config.AppURL = "http://10.1.100.171/process-code"; //

FB.URL = {};
FB.URL.Code = function()
{
	var min = 10000;
	var max = 1000000;
	var state = Math.floor(min + Math.random()*(max-min));
	
	var endpoint = "https://www.facebook.com/dialog/oauth";
	var args = {
		"response_type" : "code",
		"client_id" : FB.Config.AppID,
		"scope" : "email",
		"state" : state,
		"redirect_uri" : FB.Config.AppURL
	};
	return endpoint + "?" + HTTPHelper.ObjToQuery(args);
};
FB.URL.Token = function(inCode)
{
	var endpoint = "https://graph.facebook.com/oauth/access_token";
	var args = {
		"grant_type" : "authorization_code",
		"client_id" : FB.Config.AppID,
		"client_secret" : FB.Config.AppSecret,
		"code" : inCode,
		"redirect_uri" : FB.Config.AppURL
	};
	return endpoint + "?" + HTTPHelper.ObjToQuery(args);
};
FB.URL.Profile = function(inToken)
{
	var endpoint = "https://graph.facebook.com/me";
	var args = {
		"access_token" : inToken
	};
	return endpoint + "?" + HTTPHelper.ObjToQuery(args);
};



/*
namespace for communicating with a local MongoDB instance
*/
var DB = {};

DB.Config = {};
DB.Config.Endpoint = "mongodb://localhost:27017/auth";
DB.Config.Collection = "Users";
DB.Config.HashSecret = "aqowfhawfiohawf"; // this is prepended to the FB ID of a user before the sha1 hashing

DB.Members = {};
DB.Members.Connection = false;
DB.Members.Database = false;
DB.Members.Collection = false;

DB.Methods = {};
DB.Methods.Start = function(inHandler)
{
	DB.Members.Connection = Mongo.MongoClient.connect(DB.Config.Endpoint, function(inError, inDB)
	{
		if(inError)
			throw inError;
		
		DB.Members.Database = inDB;
		DB.Members.Database.collection(DB.Config.Collection, function(inError, inCollection)
		{
			if(inError)
				throw inError;
			
			DB.Members.Collection = inCollection;
			inHandler();
		});
	});
};
DB.Methods.Stop = function()
{
	DB.Members.Database.close();
};
DB.Access = {};
DB.Access.User = function(inHashedID)
{
	
};


/*little namespace for working with digital signatures.*/
/*
no dependencies per-se, but it does have know know about express and the cookie middleware defined in server
as some of the methods have to do with cookies.
*/
var Auth = {};
Auth.Config = {};
Auth.Config.HashSecret = "aqowfhawfiohawf"; // wow very safe. much secure.
Auth.Config.KeyID = "Auth.ID";
Auth.Config.KeyIDHash = "Auth.IDHash";
/*sign a message with the hash secret*/
Auth.Sign = function(inMessage)
{
	return sha1(Auth.Config.HashSecret + inMessage);
};
/*was this message signed with the correct secret?*/
Auth.Verify = function(inMessage, inSignedMessage)
{
	if(Auth.Sign(inMessage) === inSignedMessage)
		return true;
		
	return false;
};
Auth.CookieSet = function(inExpressResponse, inID)
{
	inExpressResponse.cookie(Auth.Config.KeyID, inID);
	inExpressResponse.cookie(Auth.Config.KeyIDHash, Auth.Sign(inID));
};
Auth.CookieGet = function()
{
	var authID, authIDHash;
	
	//inReq.Cookies is created via the cookie parser middleware
	authID = inReq.Cookies[Auth.Config.KeyID];
	authIDHash = inReq.Cookies[Auth.Config.KeyIDHash];
	
	if(authID === undefined || authIDHash === undefined)
	{
		return false;
	}
	else
	{
		return Auth.Verify(authID, authIDHash);
	}
};
Auth.CookieClear = function(inExpressResponse)
{
	inExpressResponse.clearCookie(Auth.Config.KeyID);
	inExpressResponse.clearCookie(Auth.Config.KeyIDHash);
};



/*
namespace for the web server.
its a expressjs server with some lightweight middleware for cookie-based verification.
some of the routes are part of the so-called oauth flow, others are for showing database info on user(s)
*/
/*
It needs:
FB
HTTPHelper
Auth
DB
*/
var Server = Express();

Server.engine("html", Handlebars());
Server.set("view engine", "html");
Server.use("/", Express.static(__dirname+"/")); //should be moved to a public/ directory so that app.js is not exposed
Server.use(BodyParser.urlencoded({ extended: false }));

/*my homemade cookie parser middleware*/
Server.use(function(inReq, inRes, inNext)
{
	var cookies;
	
	cookies = inReq.headers.cookie;

	inReq.Cookies = {};
	if(cookies)
	{
		cookies = cookies.split("; ");
		
		var i;
		var split;
		for(i=0; i<cookies.length; i++)
		{
			split = cookies[i].indexOf("=");
			var key = cookies[i].substring(0, split);
			var value = cookies[i].substring(split+1);
			inReq.Cookies[key] = value;
		}
	}
	inNext();
});

/*middleware to set the users current login state*/
Server.use(function(inReq, inRes, inNext)
{
	inReq.Auth = {};
	inReq.Auth.LoggedIn = Server.Utilities.CookieGet();
	inNext();
});


// Auth is a dependency here
Server.Utilities = {};
Server.Utilities.CookieSet = function(inExpressResponse, inID)
{
	inExpressResponse.cookie(Auth.Config.KeyID, inID);
	inExpressResponse.cookie(Auth.Config.KeyIDHash, Auth.Sign(inID));
};
Server.Utilities.CookieGet = function()
{
	var authID, authIDHash;
	
	//inReq.Cookies is created via the cookie parser middleware above
	authID = inReq.Cookies[Auth.Config.KeyID];
	authIDHash = inReq.Cookies[Auth.Config.KeyIDHash];
	
	if(authID === undefined || authIDHash === undefined)
	{
		return false;
	}
	else
	{
		return Auth.Verify(authID, authIDHash);
	}
};
Server.Utilities.CookieClear = function(inExpressResponse)
{
	inExpressResponse.clearCookie(Auth.Config.KeyID);
	inExpressResponse.clearCookie(Auth.Config.KeyIDHash);
};

/*this is dumb*/
Server.RenderUsers = function(inRes)
{
	DB.Members.Collection.find().toArray(function(inError, inArray)
	{
		if(inError)
			throw inError;
		
		inRes.render("users", {users:inArray});
	});
};


//actual routes start here
/*
Log in with Facebook, this is the starting point.
*/
Server.get("/login", function(inReq, inRes)
{
	if(inReq.Auth.LoggedIn)
	{
		inRes.redirect("/profile");
	}
	else
	{
		inRes.redirect(FB.URL.Code());
	}
});
Server.get("/logout", function(inReq, inRes)
{
	Server.Utilities.CookieClear(inRes);
	inRes.redirect("/profile");
});

/*
You end up here for a brief moment after choosing to log in with Facebook.
This endpoint takes facebook's query string code and uses oauth to fetch your profile, and then either matches you with an existing user, or creates a new user in mongo with your profile that it got from Facebook.
You are then presented with your resulting profile information via redirect to /profile.
*/
Server.get("/process-code", function(inReq, inRes)
{
	var queryString;
	var queryObj;
	
	queryString = inReq._parsedUrl.search;
	if(queryString === null)
	{
		inRes.render("error", {message:"no query string"});
		return;
	}

	queryObj = HTTPHelper.QueryToObj(queryString.substring(1));
	if(queryObj.code === undefined)
	{
		inRes.render("error", {message:"no code provided"});
		return;
	}
	

	//take the code and get a token
	HTTPHelper.GET(FB.URL.Token(queryObj.code), function(inData)
	{
		var tokenObj;
		
		tokenObj = HTTPHelper.QueryToObj(inData);
		if(tokenObj.access_token === undefined)
		{
			inRes.render("error", {message:"could not retrieve access_token. ---> " + inData});
			return;
		}
		
		//take the token and get the user profile
		HTTPHelper.GET(FB.URL.Profile(tokenObj.access_token), function(inData)
		{
			var profileObj;
			var IDHash;
			
			//the authentication cookies are "digitally signed" on the server with a one-way sha1 hash. this prevents people from giving themselves cookies with their own FB IDs.
			profileObj = JSON.parse(inData);
			IDHash = sha1(DB.Config.HashSecret + profileObj.id);
			
			DB.Members.Collection.findOne({"Auth.IDHash":{$eq:IDHash}}, function(inError, inRecord)
			{
				if(inError)
					throw inError;
					
				if(inRecord)
				{
					inRes.cookie("Auth.ID", inRecord.Auth.ID);
					inRes.cookie("Auth.IDHash", inRecord.Auth.IDHash);
					inRes.redirect("/profile");
				}
				else
				{
					var model = {};
					model.Auth = {};
					model.Auth.ID = profileObj.id;
					model.Auth.IDHash = sha1(DB.Config.HashSecret + profileObj.id);
					model.Auth.Token = tokenObj.access_token;
					model.Auth.Name = profileObj.name;
					model.Auth.Expires = tokenObj.expires;
					
					DB.Members.Collection.insert(model, {w:1}, function(inError, inResult)
					{
						if(inError)
							throw inError;
						
						inRes.cookie("Auth.ID", model.Auth.ID);
						inRes.cookie("Auth.IDHash", model.Auth.IDHash);
						inRes.redirect("/profile");
					});
				}
			});
		});
	});
});





/*
Draw a list of all registered users
*/
Server.use("/users", function(inReq, inRes)
{
	// this switch statement is an old thing that needs depreciated.
	switch(inReq.body.Method)
	{
		case "Post" :
			DB.Members.Collection.insert({Name:inReq.body.Name}, function(inError, inResult)
			{
				if(inError)
					throw inError;
					
				Server.RenderUsers(inRes);
			});
			break;
			
		case "Delete" :
			DB.Members.Collection.remove({_id:Mongo.ObjectId(inReq.body._id)}, function(inError, inResult)
			{
				if(inError)
					throw inError;
					
				Server.RenderUsers(inRes);
			});
			break;
		
		default :
			Server.RenderUsers(inRes);
			break;
	}
});


Server.get("/profile", function(inReq, inRes)
{
	if(inReq.Auth.LoggedIn)
	{
	
		DB.Members.Collection.findOne({"Auth.IDHash":{$eq:inReq.Cookies["Auth.IDHash"]}}, function(inError, inRecord)
		{
			if(inError)
				throw inError;
				
			if(inRecord)
			{
				inRes.render("profile", inRecord);	
			}
			else
			{
				inRes.send("could not render profile, bad credentials");
			}
		});
		
	}
	else
	{
		inRes.send("you are NOT logged in.");
	}
	
});



/*
no keys.
push to start.
*/

// connect to mongo, and when thats done, start up express.
DB.Methods.Start(function()
{
	Server.listen(80);
});



/*
not-functioning RSA encryption library.
gotta learn more about modular multiplicative inverse.
till then, i will sha1 hash things with a secret.
*/
/*
var Auth = {};
Auth.Util = {};
Auth.Util.GCD = function(inA, inB)
{
	var oldA;
	var a = inA;
	var b = inB;
	var count = 0;
	while(b != 0)
	{
		oldA = a;// make a backup of a
		a = b; // copy b into a
		b = oldA % b; 
		
		++count;
		if(count > inB)
			return "didnt work";
		
	}
	return a;
};
Auth.Util.Coprime = function(inNumber)
{
	var i;
	for(i=0; i<100; i++)
	{
		console.log(i);
		var rand = Math.floor(Math.random()*inNumber);
		if(Auth.Util.GCD(rand, inNumber) === 1)
			return rand;
	}
	return -1;
};
Auth.RSA = {};
Auth.RSA.P = 1123;
Auth.RSA.Q = 1789;
Auth.RSA.N = Auth.RSA.P*Auth.RSA.Q;
Auth.RSA.PhiN = (Auth.RSA.P - 1)*(Auth.RSA.Q - 1);
Auth.RSA.E = Auth.Util.Coprime(Auth.RSA.PhiN);
*/
