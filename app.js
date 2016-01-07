var Mongo = require("mongodb");
var Express = require("express");
var Handlebars = require("express-handlebars");
var BodyParser = require("body-parser");
var HTTPS = require("https");
var Big = require("big-integer");
var sha1 = require("sha1");



var HTTPHelper = {};
HTTPHelper.Query = {};
HTTPHelper.Query.StringToObj = function(inString)
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
HTTPHelper.Query.ObjToString = function(inObj)
{
	var output = "";
	for(prop in inObj)
	{
		output += prop + "=" + inObj[prop] + "&";
	}
	return output.substring(0, output.length-1);
};
HTTPHelper.Request = {};
HTTPHelper.Request.GET = function(inURL, inHandler)
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




var FB = {};

FB.Config = {};
FB.Config.AppID = "1628003107468799";
FB.Config.AppSecret = "2db01a126ae61f9b885262470c2abc88";
FB.Config.AppURL = "http://10.1.100.171/process-code";

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
	return endpoint + "?" + HTTPHelper.Query.ObjToString(args);
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
	return endpoint + "?" + HTTPHelper.Query.ObjToString(args);
};
FB.URL.Profile = function(inToken)
{
	var endpoint = "https://graph.facebook.com/me";
	var args = {
		"access_token" : inToken
	};
	return endpoint + "?" + HTTPHelper.Query.ObjToString(args);
};




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



var Server = Express();
Server.engine("html", Handlebars());
Server.set("view engine", "html");
Server.use("/", Express.static(__dirname+"/"));
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

/*check if user is logged in*/
Server.use(function(inReq, inRes, inNext)
{
	var authID, authIDHash;
	authID = inReq.Cookies["Auth.ID"];
	authIDHash = inReq.Cookies["Auth.IDHash"];
	inReq.Auth = {};
	
	if(authID === undefined || authIDHash === undefined)
	{
		inReq.Auth.LoggedIn = false;
	}
	else
	{
		if(sha1(DB.Config.HashSecret + authID) === authIDHash)
		{
			inReq.Auth.LoggedIn = true;
		}
		else
		{
			inReq.Auth.LoggedIn = false;
		}
	}
	
	inNext();
	
});


Server.RenderUsers = function(inRes)
{
	DB.Members.Collection.find().toArray(function(inError, inArray)
	{
		if(inError)
			throw inError;
		
		inRes.render("users", {users:inArray});
	});
};

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
	inRes.clearCookie("Auth.ID");
	inRes.clearCookie("Auth.IDHash");
	inRes.redirect("/profile");
});

/*
You end up here for a brief moment after choosing to log in with Facebook.
This endpoint takes facebook's query string code and uses oauth to fetch your profile, and then either matches you with an existing user, or creates a new user with your profile it got from Facebook.
You are then presented with your resulting profile information.
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

	queryObj = HTTPHelper.Query.StringToObj(queryString.substring(1));
	if(queryObj.code === undefined)
	{
		inRes.render("error", {message:"no code provided"});
		return;
	}
	

	//take the code and get a token
	HTTPHelper.Request.GET(FB.URL.Token(queryObj.code), function(inData)
	{
		var tokenObj;
		
		tokenObj = HTTPHelper.Query.StringToObj(inData);
		if(tokenObj.access_token === undefined)
		{
			inRes.render("error", {message:"could not retrieve access_token. ---> " + inData});
			return;
		}
		
		//take the token and get the user profile
		HTTPHelper.Request.GET(FB.URL.Profile(tokenObj.access_token), function(inData)
		{
			var profileObj;
			var IDHash;
			
			profileObj = JSON.parse(inData);
			IDHash = sha1(DB.Config.HashSecret + profileObj.id)
			
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



DB.Methods.Start(function()
{
	Server.listen(80);
});